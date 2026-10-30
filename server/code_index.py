"""Full-text index over the code of every configured project.

Files are cut into overlapping line windows (chunk_lines / chunk_overlap) and
stored in code_chunks + code_fts. Each machine builds its own; never synced.
"""
from __future__ import annotations

import fnmatch
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

LANGUAGES = {
    "ts": "typescript", "tsx": "tsx", "js": "javascript", "mjs": "javascript", "cjs": "javascript",
    "jsx": "jsx", "py": "python", "rs": "rust", "go": "go", "rb": "ruby", "java": "java",
    "kt": "kotlin", "swift": "swift", "c": "c", "h": "c", "cpp": "cpp", "hpp": "cpp",
    "css": "css", "scss": "scss", "html": "html", "vue": "vue", "svelte": "svelte", "astro": "astro",
    "md": "markdown", "mdx": "mdx", "txt": "text", "toml": "toml", "yaml": "yaml", "yml": "yaml",
    "json": "json", "sh": "shell", "zsh": "shell", "bash": "shell", "sql": "sql",
    "graphql": "graphql", "prisma": "prisma",
}


def language_for(ext: str) -> str:
    return LANGUAGES.get(ext, ext)


def load_ignore_globs(root: Path) -> list[str]:
    f = root / ".aimemoryignore"
    if not f.exists():
        return []
    out = []
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        out.append(line.rstrip("/"))
    return out


def _is_skipped(rel: Path, skip_dirs: set, globs: list[str]) -> bool:
    parts = rel.parts
    if any(p in skip_dirs for p in parts):
        return True
    posix = rel.as_posix()
    for g in globs:
        if fnmatch.fnmatch(posix, g) or fnmatch.fnmatch(rel.name, g):
            return True
        if any(fnmatch.fnmatch(p, g) for p in parts):
            return True
    return False


def walk(cfg, proj, globs: list[str] | None = None):
    globs = load_ignore_globs(cfg.root) if globs is None else globs
    if not proj.path.exists():
        return
    for p in proj.path.rglob("*"):
        try:
            if not p.is_file():
                continue
            rel = p.relative_to(proj.path)
            if _is_skipped(rel, cfg.skip_dirs, globs):
                continue
            ext = p.suffix.lower().lstrip(".")
            if ext not in cfg.text_extensions:
                continue
            if p.stat().st_size > cfg.max_file_bytes:
                continue
        except OSError:
            continue
        yield p


def chunk(text: str, chunk_lines: int = 60, chunk_overlap: int = 10) -> list[tuple[int, int, str]]:
    lines = text.splitlines()
    n = len(lines)
    step = max(1, chunk_lines - chunk_overlap)
    out = []
    i = 0
    while i < n:
        end = min(i + chunk_lines, n)
        body = "\n".join(lines[i:end])
        if body.strip():
            out.append((i + 1, end, body))
        if end >= n:
            break
        i += step
    return out


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _delete_file(conn: sqlite3.Connection, path: str) -> None:
    conn.execute("DELETE FROM code_fts WHERE path=?", (path,))
    conn.execute("DELETE FROM code_chunks WHERE path=?", (path,))
    conn.execute("DELETE FROM code_files WHERE path=?", (path,))


def index_file(conn: sqlite3.Connection, cfg, proj, p: Path) -> None:
    path = str(p.resolve())
    st = p.stat()
    text = p.read_text(encoding="utf-8", errors="ignore")
    conn.execute("DELETE FROM code_fts WHERE path=?", (path,))
    conn.execute("DELETE FROM code_chunks WHERE path=?", (path,))
    ext = p.suffix.lower().lstrip(".")
    conn.execute(
        """INSERT INTO code_files (path,project,language,size_bytes,mtime,indexed_at) VALUES (?,?,?,?,?,?)
           ON CONFLICT(path) DO UPDATE SET project=excluded.project, language=excluded.language,
             size_bytes=excluded.size_bytes, mtime=excluded.mtime, indexed_at=excluded.indexed_at""",
        (path, proj.name, language_for(ext), st.st_size, st.st_mtime, _now()),
    )
    for start, end, body in chunk(text, cfg.chunk_lines, cfg.chunk_overlap):
        cur = conn.execute(
            "INSERT INTO code_chunks (path,project,line_start,line_end,body) VALUES (?,?,?,?,?)",
            (path, proj.name, start, end, body),
        )
        conn.execute(
            "INSERT INTO code_fts (chunk_id,path,project,body) VALUES (?,?,?,?)",
            (cur.lastrowid, path, proj.name, body),
        )


def index_project(conn: sqlite3.Connection, cfg, proj, force: bool = False) -> tuple[int, int]:
    indexed = skipped = 0
    seen: set[str] = set()
    known = {r["path"]: r["mtime"] for r in conn.execute("SELECT path, mtime FROM code_files WHERE project=?", (proj.name,))}
    conn.execute("BEGIN")
    try:
        for p in walk(cfg, proj):
            path = str(p.resolve())
            seen.add(path)
            try:
                mtime = p.stat().st_mtime
                if not force and path in known and known[path] is not None and abs(known[path] - mtime) < 1e-6:
                    skipped += 1
                    continue
                index_file(conn, cfg, proj, p)
                indexed += 1
            except OSError:
                continue
        for path in known:
            if path not in seen and not Path(path).exists():
                _delete_file(conn, path)
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    return indexed, skipped


def index_all(conn: sqlite3.Connection, cfg, force: bool = False) -> dict:
    out = {}
    for proj in cfg.projects:
        t = time.time()
        exists = proj.path.exists()
        indexed, skipped = index_project(conn, cfg, proj, force=force) if exists else (0, 0)
        out[proj.name] = {"indexed": indexed, "skipped": skipped, "seconds": round(time.time() - t, 2), "exists": exists}
    return out


def search(conn: sqlite3.Connection, query: str, project: str | None = None, limit: int = 20) -> list[dict]:
    if not query or not query.strip():
        return []
    sql = (
        "SELECT c.path, c.project, c.line_start, c.line_end, c.body, bm25(code_fts) AS rank "
        "FROM code_fts JOIN code_chunks c ON c.id = code_fts.chunk_id WHERE code_fts MATCH ?"
    )
    params: list = ['"' + query.strip().replace('"', '""') + '"']
    if project:
        sql += " AND c.project=?"
        params.append(project)
    sql += " ORDER BY rank LIMIT ?"
    params.append(limit)
    try:
        return [dict(r) for r in conn.execute(sql, params)]
    except sqlite3.OperationalError:
        return []


def read(path: str, line_start: int | None = None, line_end: int | None = None) -> str:
    p = Path(path).expanduser()
    if not p.exists() or not p.is_file():
        return ""
    text = p.read_text(encoding="utf-8", errors="ignore")
    if line_start is None and line_end is None:
        return text
    lines = text.splitlines()
    start = max(1, line_start or 1)
    end = min(len(lines), line_end if line_end is not None else len(lines))
    return "\n".join(lines[start - 1 : end])


def project_summary(conn: sqlite3.Connection, cfg) -> list[dict]:
    out = []
    for proj in cfg.projects:
        row = conn.execute(
            "SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes),0) AS b FROM code_files WHERE project=?", (proj.name,)
        ).fetchone()
        langs = conn.execute(
            "SELECT language AS name, COUNT(*) AS files FROM code_files WHERE project=? GROUP BY language ORDER BY files DESC",
            (proj.name,),
        ).fetchall()
        out.append({"project": proj.name, "files": row["n"], "bytes": row["b"], "languages": [dict(l) for l in langs]})
    return out
