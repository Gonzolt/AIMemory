"""Daily morning brief: memories/_briefs/YYYY-MM-DD.md and memories/Brief.md.

maybe_generate()  — API scheduler; builds once a day at/after 07:40 local, never waits for the lock.
generate()        — `aim brief`; always builds, waits up to 240 s for the lock.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from server import config, db, memory
from server.oscompat import FileLock

DUE_AT = (7, 40)
MARKER_RE = re.compile(r"<!-- aim-brief generated=(\S+) source=(\w+) -->")
NO_MARKERS = set("og er det som ikke har jeg vi skal må kan til fra med på hva hvor hvordan også etter før".split())
EN_MARKERS = set("the and is are with that this for from not have will should what where how also after before".split())

HEADINGS = {
    "en": ("The one move", "Since last brief", "Open", "Code"),
    "no": ("Viktigste trekk", "Siden sist", "Åpent", "Kode"),
}


def _briefs_dir(cfg) -> Path:
    return cfg.memories / "_briefs"


def _today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def due(cfg=None) -> bool:
    cfg = cfg or config.load()
    now = datetime.now()
    if (now.hour, now.minute) < DUE_AT:
        return False
    return not (_briefs_dir(cfg) / f"{_today()}.md").exists()


def maybe_generate(cfg=None) -> Path | None:
    cfg = cfg or config.load()
    if not due(cfg):
        return None
    lock = FileLock(cfg.aim_dir / "brief.lock")
    if not lock.acquire(timeout=0):
        return None
    try:
        if not due(cfg):
            return None
        return _build(cfg)
    finally:
        lock.release()


def generate(cfg=None) -> Path:
    cfg = cfg or config.load()
    lock = FileLock(cfg.aim_dir / "brief.lock")
    if not lock.acquire(timeout=240):
        raise TimeoutError("another brief is being written (.aim/brief.lock)")
    try:
        return _build(cfg)
    finally:
        lock.release()


# --------------------------------------------------------------------------- gathering

def _window_start(cfg) -> datetime:
    briefs = sorted(p for p in _briefs_dir(cfg).glob("*.md") if re.match(r"\d{4}-\d{2}-\d{2}\.md$", p.name))
    if briefs:
        last = briefs[-1]
        m = MARKER_RE.search(last.read_text(encoding="utf-8", errors="ignore"))
        if m:
            try:
                return datetime.fromisoformat(m.group(1).replace("Z", "+00:00"))
            except ValueError:
                pass
        return datetime.fromtimestamp(last.stat().st_mtime, tz=timezone.utc)
    return datetime.now(timezone.utc) - timedelta(hours=24)


def _excerpt(body: str, n: int = 150) -> str:
    s = re.sub(r"```.*?```", " ", body, flags=re.S)
    s = re.sub(r"\[\[([^\]|]+)(\|[^\]]+)?\]\]", r"\1", s)
    s = re.sub(r"[#*_`>|\[\]]+", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:n] + ("…" if len(s) > n else "")


def _status(tags: list[str]) -> str:
    return next((t.split(":", 1)[1] for t in tags if t.startswith("status:")), "todo")


def _git_log(repos: list[Path], since: datetime) -> list[str]:
    lines, seen = [], set()
    for repo in repos:
        if not (repo / ".git").exists() and not (repo / ".git").is_file():
            continue
        try:
            r = subprocess.run(
                ["git", "log", "--all", "--no-merges", f"--since={since.isoformat()}", "--format=%h %ad %s", "--date=short"],
                cwd=repo, capture_output=True, text=True, encoding="utf-8", timeout=20,
            )
        except (OSError, subprocess.TimeoutExpired):
            continue
        for line in r.stdout.splitlines():
            subject = line.split(" ", 2)[-1] if line.count(" ") >= 2 else line
            if subject in seen:
                continue
            seen.add(subject)
            lines.append(f"{repo.name}: {line}")
    return lines[:40]


def _disk_note(cfg) -> str | None:
    scouts = sorted((cfg.aim_dir / "cleanup").glob("scout-*.json"))
    if not scouts or time.time() - scouts[-1].stat().st_mtime > 8 * 86400:
        return None
    try:
        rep = json.loads(scouts[-1].read_text(encoding="utf-8"))
    except ValueError:
        return None
    gb = rep.get("reclaimable_bytes", 0) / 1e9
    return f"Disk: about {gb:.0f} GB can be freed (aim clean)." if gb >= 10 else None


def gather(cfg) -> dict:
    conn = db.connect(cfg.memory_db)
    since = _window_start(cfg)
    since_iso = since.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = [memory.row_to_dict(r) for r in conn.execute(
        "SELECT * FROM memories WHERE updated >= ? ORDER BY updated DESC", (since_iso,))]
    changed = [{"id": m["id"], "type": m["type"], "title": m["title"],
                "kind": "new" if m["created"] >= since_iso else "upd", "excerpt": _excerpt(m["body"])} for m in rows]
    tasks = [m for m in memory.list_all(conn, type="task", limit=500)
             if _status(m["tags"]) != "done" and m["status"] not in ("archived", "superseded")]
    open_tasks = [{"id": m["id"], "title": m["title"], "status": _status(m["tags"]), "updated": m["updated"]} for m in tasks]
    pinned = [{"id": m["id"], "title": m["title"]} for m in memory.list_all(conn, limit=500)
              if "pinned:true" in m["tags"] or "pinned" in m["tags"]]
    ids = {m["id"] for m in rows}
    conflicts = [dict(r) for r in conn.execute("SELECT src, dst FROM edges WHERE kind='conflicts_with'")
                 if r["src"] in ids or r["dst"] in ids]
    by_type, by_actor, touched = Counter(), Counter(), Counter()
    since_ts = since.timestamp()
    try:
        for line in cfg.events_path.read_text(encoding="utf-8").splitlines()[-5000:]:
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            if ev.get("ts", 0) < since_ts:
                continue
            by_type[ev.get("type", "?")] += 1
            if ev.get("type") == "memory_accessed":
                by_actor[f"{ev.get('agent', '?')}/{ev.get('op', '?')}"] += 1
                touched.update(ev.get("ids", []))
    except OSError:
        pass
    repos = cfg.brief_repos or [cfg.root]
    conn.close()
    return {
        "since": since_iso,
        "changed": changed,
        "open_tasks": open_tasks,
        "pinned": pinned,
        "conflicts": conflicts,
        "events": {"by_type": dict(by_type), "by_actor": dict(by_actor.most_common(10)),
                   "most_accessed": [i for i, _ in touched.most_common(5)]},
        "commits": _git_log(repos, since),
        "disk": _disk_note(cfg),
    }


def detect_language(data: dict) -> str:
    text = " ".join([c["title"] + " " + c["excerpt"] for c in data["changed"]] +
                    [t["title"] for t in data["open_tasks"]]).lower()
    words = re.findall(r"\w+", text)
    no = sum(1 for w in words if w in NO_MARKERS) + len(re.findall(r"[æøå]", text))
    en = sum(1 for w in words if w in EN_MARKERS)
    return "no" if no > en else "en"


# --------------------------------------------------------------------------- writing

OWNER = os.environ.get("AIM_OWNER_NAME", "the owner")


def _prompt(data: dict, lang: str, date: str) -> str:
    h = HEADINGS[lang]
    return (
        f"Write {OWNER}'s morning brief for {date} from the data below. Under 250 words. "
        f"Output exactly this structure: a title line `# Brief {date}` then four sections "
        f"`## {h[0]}`, `## {h[1]}`, `## {h[2]}`, `## {h[3]}`. "
        f"Write in {'Norwegian (bokmål)' if lang == 'no' else 'English'}. "
        "The first section is one sentence: the single most useful thing to do today. "
        "Cite memory ids only if they appear in the data, in parentheses. "
        "Short plain prose. No bullets, no emoji, no icons, no '·' chains, no decorative bold.\n\n"
        "# Data\n" + json.dumps(data, ensure_ascii=False, indent=1)
    )


def _call_model(prompt: str, cfg) -> tuple[str | None, str]:
    exe = shutil.which("claude")
    if not exe:
        return None, "claude CLI not found"
    env = dict(os.environ)
    env.pop("CLAUDECODE", None)
    env.pop("CLAUDE_CODE_ENTRYPOINT", None)
    args = [exe, "-p", "--tools", "", "--strict-mcp-config", "--model", "sonnet", "--no-session-persistence",
            "--disable-slash-commands"]
    try:
        r = subprocess.run(args, input=prompt, capture_output=True, text=True, encoding="utf-8", timeout=180,
                           cwd=cfg.aim_dir, env=env)
    except (OSError, subprocess.TimeoutExpired) as e:
        return None, f"model call failed: {type(e).__name__}"
    if r.returncode != 0 or not r.stdout.strip():
        return None, f"model exited {r.returncode}"
    return r.stdout, ""


def _hygiene(text: str, date: str, known_ids: set[str]) -> str | None:
    t = text.strip()
    m = re.match(r"^```[a-z]*\n(.*?)\n```$", t, re.S)
    if m:
        t = m.group(1).strip()
    lines = t.splitlines()
    if lines and lines[0].startswith("# "):
        lines[0] = f"# Brief {date}"
    else:
        lines.insert(0, f"# Brief {date}")
    t = "\n".join(lines)
    if len(re.findall(r"^## ", t, re.M)) < 3:
        return None

    def strip_unknown(mt):
        ids = [i.strip() for i in mt.group(1).split(",")]
        return mt.group(0) if all(i in known_ids for i in ids) else ""

    t = re.sub(r" ?\(([a-z0-9][a-z0-9-]*(?:,\s*[a-z0-9][a-z0-9-]*)*)\)", strip_unknown, t)
    return t.strip() + "\n"


def _fallback(data: dict, lang: str, date: str, reason: str) -> str:
    h = HEADINGS[lang]
    tasks = data["open_tasks"]
    hot = [t for t in tasks if t["status"] in ("doing", "blocked")]
    decisions = [c for c in data["changed"] if c["type"] == "decision"]
    if hot:
        t = sorted(hot, key=lambda x: x["updated"])[-1]
        move = f"Pick up {t['title']} ({t['id']}), which is {t['status']}."
    elif decisions:
        move = f"Act on the latest decision, {decisions[0]['title']} ({decisions[0]['id']})."
    elif tasks:
        t = sorted(tasks, key=lambda x: x["updated"])[-1]
        move = f"Start {t['title']} ({t['id']})."
    else:
        move = "Nothing is waiting; choose today's focus and write it down as a task."
    changed = data["changed"]
    since = (f"{len(changed)} memories changed: " + ", ".join(f"{c['title']} ({c['id']})" for c in changed[:6]) + "."
             if changed else "No memories changed.")
    open_ = (f"{len(tasks)} open tasks: " + ", ".join(f"{t['title']} ({t['id']}, {t['status']})" for t in tasks[:6]) + "."
             if tasks else "No open tasks.")
    if data["conflicts"]:
        open_ += f" {len(data['conflicts'])} conflicts_with links touch recent memories."
    code = (f"{len(data['commits'])} commits: " + "; ".join(c.split(' ', 3)[-1] for c in data["commits"][:6]) + "."
            if data["commits"] else "No commits in the window.")
    if data["disk"]:
        code += " " + data["disk"]
    return (f"# Brief {date}\n\n## {h[0]}\n\n{move}\n\n## {h[1]}\n\n{since}\n\n## {h[2]}\n\n{open_}\n\n"
            f"## {h[3]}\n\n{code}\n\nWritten without the model ({reason}).\n")


def _atomic_write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.tmp")
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)
    os.replace(tmp, path)


def _notify(move: str) -> None:
    if sys.platform == "darwin" and shutil.which("osascript"):
        safe = move.replace('"', "'")[:200]
        subprocess.run(["osascript", "-e", f'display notification "{safe}" with title "Morning brief"'],
                       capture_output=True, timeout=10)


def _build(cfg) -> Path:
    date = _today()
    data = gather(cfg)
    lang = detect_language(data)
    known = {c["id"] for c in data["changed"]} | {t["id"] for t in data["open_tasks"]} | {p["id"] for p in data["pinned"]} \
        | set(data["events"]["most_accessed"])
    out, reason = _call_model(_prompt(data, lang, date), cfg)
    text = _hygiene(out, date, known) if out else None
    source = "claude"
    if not text:
        text = _fallback(data, lang, date, reason or "model output failed the format check")
        source = "fallback"
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    text = text.rstrip() + f"\n\n<!-- aim-brief generated={stamp} source={source} -->\n"
    path = _briefs_dir(cfg) / f"{date}.md"
    _atomic_write(path, text)
    _atomic_write(cfg.memories / "Brief.md", text)
    m = re.search(r"^## .+\n\n(.+)$", text, re.M)
    _notify(m.group(1) if m else f"Brief {date}")
    return path


if __name__ == "__main__":
    print(generate())
