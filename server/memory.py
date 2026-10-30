"""Canonical memory store: one markdown file per memory, mirrored into SQLite.

Markdown under memories/<type>/<id>.md is the source of truth. The SQLite
index (memories, edges, memories_fts) can be rebuilt from it at any time.
"""
from __future__ import annotations

import json
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

VALID_TYPES = {"user", "feedback", "project", "reference", "decision", "conversation", "code", "task"}
VALID_EDGE_KINDS = {"part_of", "derived_from", "supersedes", "conflicts_with", "mentions", "produced_by"}

STOPWORDS = set("""
the and for that with this from are was were not but you your have has had into what when where which
about after before how all any our out one two use used new now did does should would could
decide decided decision know remember tell find show give think want need make made get
og er det som en på til av med ikke har var de den et vi jeg du kan skal vil må fra men om så når
eller hva hvor hvordan alle mer noe noen være blir ble bare også etter før
bestemte bestemt besluttet vet huske husker fortell finne vise vil trenger
""".split())


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def slugify(s: str) -> str:
    s = re.sub(r"[^a-z0-9-]+", "-", (s or "").lower().strip()).strip("-")
    return s or "untitled"


# --------------------------------------------------------------------------- format

_SPECIAL_START = set("-?:,[]{}#&*!|>'\"%@`")
_RESERVED = re.compile(r"^(true|false|yes|no|on|off|null|~|[-+]?\d+(\.\d+)?)$", re.I)


def _yaml_scalar(s) -> str:
    s = str(s)
    if (
        not s
        or s != s.strip()
        or s[0] in _SPECIAL_START
        or ": " in s
        or " #" in s
        or "\n" in s
        or s.endswith(":")
        or _RESERVED.match(s)
    ):
        return json.dumps(s, ensure_ascii=False)
    return s


@dataclass
class Memory:
    id: str
    type: str
    title: str
    body: str = ""
    created: str = ""
    updated: str = ""
    agents: list[str] = field(default_factory=list)
    projects: list[str] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    status: str = "active"
    confidence: str = "medium"
    links: list[dict] = field(default_factory=list)
    path: Path | None = None

    def to_markdown(self) -> str:
        out = ["---"]
        out.append(f"id: {_yaml_scalar(self.id)}")
        out.append(f"type: {_yaml_scalar(self.type)}")
        out.append(f"title: {_yaml_scalar(self.title)}")
        out.append(f"created: {_yaml_scalar(self.created)}")
        out.append(f"updated: {_yaml_scalar(self.updated)}")
        for key in ("agents", "projects", "tags"):
            out.extend(_block_list(key, getattr(self, key)))
        out.append(f"status: {_yaml_scalar(self.status)}")
        out.append(f"confidence: {_yaml_scalar(self.confidence)}")
        if self.links:
            out.append("links:")
            for l in self.links:
                out.append(f"  - to: {_yaml_scalar(l['to'])}")
                out.append(f"    kind: {_yaml_scalar(l['kind'])}")
        else:
            out.append("links: []")
        related = list(dict.fromkeys(l["to"] for l in self.links))
        if related:
            out.extend(_block_list("related", [f"[[{r}]]" for r in related]))
        if self.projects:
            out.extend(_block_list("hubs", [f"[[_projects/{p}]]" for p in self.projects]))
        out.append("---")
        return "\n".join(out) + "\n" + self.body.rstrip() + "\n"


def _block_list(key: str, items: list) -> list[str]:
    if not items:
        return [f"{key}: []"]
    return [f"{key}:"] + [f"  - {_yaml_scalar(i)}" for i in items]


_FRONT_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.S)


def _coerce(v: str):
    v = v.strip()
    if len(v) >= 2 and v[0] == '"' and v[-1] == '"':
        try:
            return json.loads(v)
        except ValueError:
            return v[1:-1]
    if v == "true":
        return True
    if v == "false":
        return False
    if v.isdigit():
        return int(v)
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
        return v[1:-1]
    return v


def _split_inline(inner: str) -> list[str]:
    parts, buf, q = [], "", None
    for ch in inner:
        if q:
            buf += ch
            if ch == q:
                q = None
        elif ch in "'\"":
            q = ch
            buf += ch
        elif ch == ",":
            parts.append(buf)
            buf = ""
        else:
            buf += ch
    if buf.strip():
        parts.append(buf)
    return [p.strip() for p in parts if p.strip()]


def _parse_link_block(raw: str) -> list[dict]:
    links: list[dict] = []
    cur: dict | None = None
    inside = False
    for line in raw.splitlines():
        if not inside:
            if re.match(r"^links:\s*$", line):
                inside = True
            continue
        if line and not line[0].isspace() and not line.startswith("-"):
            break
        s = line.strip()
        if s.startswith("- "):
            if cur is not None:
                links.append(cur)
            cur = {}
            s = s[2:].strip()
        if cur is None or ":" not in s:
            continue
        k, _, v = s.partition(":")
        if k.strip() in ("to", "kind"):
            cur[k.strip()] = _coerce(v)
    if cur is not None:
        links.append(cur)
    return [{"to": str(l["to"]), "kind": str(l["kind"])} for l in links if l.get("to") and l.get("kind")]


def _parse_front(text: str) -> tuple[dict, str]:
    text = text.replace("\r\n", "\n")
    m = _FRONT_RE.match(text)
    if not m:
        return {}, text
    raw, body = m.group(1), m.group(2)
    data: dict = {}
    key = None
    for line in raw.splitlines():
        if not line.strip():
            continue
        if not line[0].isspace() and not line.startswith("-") and ":" in line:
            k, _, v = line.partition(":")
            key, v = k.strip(), v.strip()
            if v == "":
                data[key] = []
            elif v.startswith("[") and v.endswith("]"):
                inner = v[1:-1].strip()
                data[key] = [_coerce(x) for x in _split_inline(inner)] if inner else []
            else:
                data[key] = _coerce(v)
        elif key is not None and line.lstrip().startswith("-"):
            if isinstance(data.get(key), list):
                data[key].append(_coerce(line.lstrip()[1:].strip()))
    data["links"] = _parse_link_block(raw)
    return data, body


def _listify(v) -> list[str]:
    if v is None or v == "":
        return []
    if isinstance(v, list):
        return [str(x) for x in v if str(x) != ""]
    return [str(v)]


def load_file(path: str | Path) -> Memory | None:
    path = Path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    data, body = _parse_front(text)
    if not data.get("id"):
        return None
    now = now_iso()
    return Memory(
        id=str(data["id"]),
        type=str(data.get("type") or "reference"),
        title=str(data.get("title") or path.stem),
        body=body,
        created=str(data.get("created") or now),
        updated=str(data.get("updated") or now),
        agents=_listify(data.get("agents")),
        projects=_listify(data.get("projects")),
        tags=_listify(data.get("tags")),
        status=str(data.get("status") or "active"),
        confidence=str(data.get("confidence") or "medium"),
        links=data.get("links") or [],
        path=path.resolve(),
    )


def _write_file(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def save(mem: Memory) -> None:
    """Rewrite an already-loaded memory's file as-is (used by memory_link)."""
    assert mem.path is not None
    _write_file(Path(mem.path), mem.to_markdown())


HUB_TEMPLATE = """# {p}

Project hub for the Obsidian graph. Memories link here through their `projects` field. Generated by AIMemory; not a memory.

```dataview
TABLE WITHOUT ID link(file.path, title) AS Memory, type AS Type, updated AS Updated
FROM "" WHERE contains(projects, "{p}")
SORT updated DESC
```
"""


def ensure_project_hubs(cfg, projects: list[str]) -> None:
    for p in projects or []:
        hub = cfg.memories / "_projects" / f"{p}.md"
        if not hub.exists():
            _write_file(hub, HUB_TEMPLATE.format(p=p))


def write_memory(
    cfg,
    *,
    type: str,
    title: str,
    body: str,
    id: str | None = None,
    agents: list[str] | None = None,
    projects: list[str] | None = None,
    tags: list[str] | None = None,
    links: list[dict] | None = None,
    confidence: str = "medium",
    status: str = "active",
) -> Memory:
    if type not in VALID_TYPES:
        raise ValueError(f"invalid type: {type} (allowed: {sorted(VALID_TYPES)})")
    mid = id if id else slugify(title)
    path = (cfg.memories / type / f"{mid}.md").resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    existing = load_file(path) if path.exists() else None
    now = now_iso()
    mem = Memory(
        id=mid,
        type=type,
        title=title,
        body=body or "",
        created=existing.created if existing else now,
        updated=now,
        agents=list(agents or (existing.agents if existing else None) or []),
        projects=list(projects or (existing.projects if existing else None) or []),
        tags=list(tags or (existing.tags if existing else None) or []),
        links=list(links or (existing.links if existing else None) or []),
        confidence=confidence,
        status=status,
        path=path,
    )
    _write_file(path, mem.to_markdown())
    ensure_project_hubs(cfg, mem.projects)
    return mem


# --------------------------------------------------------------------------- index

def upsert(conn: sqlite3.Connection, mem: Memory) -> None:
    path = str(Path(mem.path).resolve()) if mem.path else ""
    try:
        mtime = Path(path).stat().st_mtime if path else None
    except OSError:
        mtime = None
    # A hand-edited id leaves a stale row on the same path; clear it first.
    for r in conn.execute("SELECT id FROM memories WHERE path=? AND id<>?", (path, mem.id)).fetchall():
        conn.execute("DELETE FROM memories_fts WHERE id=?", (r["id"],))
        conn.execute("DELETE FROM memories WHERE id=?", (r["id"],))
    conn.execute(
        """INSERT INTO memories (id,type,title,body,path,created,updated,agents,projects,tags,status,confidence,file_mtime)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             type=excluded.type, title=excluded.title, body=excluded.body, path=excluded.path,
             updated=excluded.updated, agents=excluded.agents, projects=excluded.projects,
             tags=excluded.tags, status=excluded.status, confidence=excluded.confidence,
             file_mtime=excluded.file_mtime""",
        (
            mem.id, mem.type, mem.title, mem.body, path, mem.created, mem.updated,
            json.dumps(mem.agents, ensure_ascii=False), json.dumps(mem.projects, ensure_ascii=False),
            json.dumps(mem.tags, ensure_ascii=False), mem.status, mem.confidence, mtime,
        ),
    )
    conn.execute("DELETE FROM memories_fts WHERE id=?", (mem.id,))
    conn.execute("INSERT INTO memories_fts (id,title,body) VALUES (?,?,?)", (mem.id, mem.title, mem.body))
    conn.execute("DELETE FROM edges WHERE src=?", (mem.id,))
    _insert_links(conn, mem)


def _insert_links(conn: sqlite3.Connection, mem: Memory) -> None:
    for l in mem.links:
        if l.get("kind") not in VALID_EDGE_KINDS:
            continue
        try:
            conn.execute("INSERT OR IGNORE INTO edges (src,dst,kind) VALUES (?,?,?)", (mem.id, l["to"], l["kind"]))
        except sqlite3.IntegrityError:
            pass  # dangling dst; picked up by reindex once it exists


def delete_by_path(conn: sqlite3.Connection, path: str | Path) -> str | None:
    row = conn.execute("SELECT id FROM memories WHERE path=?", (str(Path(path).resolve()),)).fetchone()
    if not row:
        return None
    conn.execute("DELETE FROM memories_fts WHERE id=?", (row["id"],))
    conn.execute("DELETE FROM memories WHERE id=?", (row["id"],))
    return row["id"]


def reindex_all(cfg, conn: sqlite3.Connection) -> int:
    seen: set[str] = set()
    mems: list[Memory] = []
    conn.execute("BEGIN")
    try:
        for p in sorted(cfg.memories.rglob("*.md")):
            if any(part.startswith(".") for part in p.relative_to(cfg.memories).parts):
                continue
            mem = load_file(p)
            if not mem:
                continue
            upsert(conn, mem)
            seen.add(str(mem.path))
            mems.append(mem)
        for r in conn.execute("SELECT id, path FROM memories").fetchall():
            if r["path"] not in seen:
                conn.execute("DELETE FROM memories_fts WHERE id=?", (r["id"],))
                conn.execute("DELETE FROM memories WHERE id=?", (r["id"],))
        # second pass: edges whose dst was indexed after their src
        for mem in mems:
            _insert_links(conn, mem)
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return len(mems)


# --------------------------------------------------------------------------- queries

def row_to_dict(r: sqlite3.Row) -> dict:
    d = dict(r)
    for k in ("agents", "projects", "tags"):
        try:
            d[k] = json.loads(d.get(k) or "[]")
        except (TypeError, ValueError):
            d[k] = []
    return d


def get(conn: sqlite3.Connection, id: str) -> dict | None:
    r = conn.execute("SELECT * FROM memories WHERE id=?", (id,)).fetchone()
    return row_to_dict(r) if r else None


def recent(conn: sqlite3.Connection, limit: int = 10) -> list[dict]:
    return [row_to_dict(r) for r in conn.execute("SELECT * FROM memories ORDER BY updated DESC LIMIT ?", (limit,))]


def list_all(conn: sqlite3.Connection, type: str | None = None, project: str | None = None, limit: int = 200) -> list[dict]:
    sql, params = "SELECT * FROM memories WHERE 1=1", []
    if type:
        sql += " AND type=?"
        params.append(type)
    if project:
        sql += " AND projects LIKE ?"
        params.append(f'%"{project}"%')
    sql += " ORDER BY updated DESC LIMIT ?"
    params.append(limit)
    return [row_to_dict(r) for r in conn.execute(sql, params)]


def _phrase(s: str) -> str:
    return '"' + s.replace('"', '""') + '"'


def _fts(conn, match: str, type: str | None, project: str | None, limit: int) -> list[sqlite3.Row]:
    sql = (
        "SELECT m.*, bm25(memories_fts, 0.0, 4.0, 1.0) AS rank FROM memories_fts "
        "JOIN memories m ON m.id = memories_fts.id WHERE memories_fts MATCH ?"
    )
    params: list = [match]
    if type:
        sql += " AND m.type=?"
        params.append(type)
    if project:
        sql += " AND m.projects LIKE ?"
        params.append(f'%"{project}"%')
    sql += " ORDER BY rank LIMIT ?"
    params.append(limit)
    try:
        return conn.execute(sql, params).fetchall()
    except sqlite3.OperationalError:
        return []


def search(conn: sqlite3.Connection, query: str, type: str | None = None, project: str | None = None, limit: int = 20) -> list[dict]:
    if not query or not query.strip():
        return recent(conn, limit)
    rows = list(_fts(conn, _phrase(query.strip()), type, project, limit))
    words = [w for w in dict.fromkeys(re.findall(r"[a-zæøå0-9][a-zæøå0-9-]{2,}", query.lower())) if w not in STOPWORDS]
    if len(words) > 1 and len(rows) < limit:
        seen = {r["id"] for r in rows}
        quoted = [_phrase(w) for w in words]
        for match in (" AND ".join(quoted), " OR ".join(quoted)):
            for r in _fts(conn, match, type, project, limit):
                if r["id"] not in seen and len(rows) < limit:
                    rows.append(r)
                    seen.add(r["id"])
    return [row_to_dict(r) for r in rows]


def edges(conn: sqlite3.Connection) -> list[dict]:
    return [dict(r) for r in conn.execute("SELECT src, dst, kind FROM edges")]


def add_edge(conn: sqlite3.Connection, src: str, dst: str, kind: str = "mentions") -> bool:
    """Insert the edge and persist it into the src file. False if either id is unknown."""
    if kind not in VALID_EDGE_KINDS:
        raise ValueError(f"invalid kind: {kind} (allowed: {sorted(VALID_EDGE_KINDS)})")
    s, d = get(conn, src), get(conn, dst)
    if not s or not d:
        return False
    conn.execute("INSERT OR IGNORE INTO edges (src,dst,kind) VALUES (?,?,?)", (src, dst, kind))
    mem = load_file(s["path"])
    if mem:
        if not any(l["to"] == dst and l["kind"] == kind for l in mem.links):
            mem.links.append({"to": dst, "kind": kind})
        mem.updated = now_iso()
        save(mem)
    return True
