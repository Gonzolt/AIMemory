"""Scripted live demo (POST /demo). Writes a small story into the hub step by step,
links it, replays agent activity for the galaxy, then removes it again.

Run with the watcher up so the UI animates:  python scripts/demo.py
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import config, db, memory  # noqa: E402

cfg = config.load()
conn = db.connect(cfg.memory_db)
STEP = 1.6

STORY = [
    ("decision", "demo-cache-layer", "Demo: put a read-through cache in front of search",
     "**Context**\nSearch latency spiked when three agents queried at once.\n\n**Decision**\nAdd a 60 s read-through cache keyed by query.",
     ["claude-code"]),
    ("task", "demo-cache-task", "Demo: implement the search cache",
     "**Goal**\nShip the cache behind a flag.\n\n**Acceptance**\n- [ ] p95 under 50 ms", ["codex"]),
    ("reference", "demo-cache-research", "Demo: research on cache invalidation",
     "**Findings**\nWrite-through invalidation on memory_changed events is enough for a single-user hub.", ["cursor"]),
    ("conversation", "demo-cache-session", "Demo: codex session on the search cache",
     "**What I did**\n- Added the cache\n- Wired invalidation to the watcher events", ["codex"]),
]
LINKS = [
    ("demo-cache-task", "demo-cache-layer", "derived_from"),
    ("demo-cache-research", "demo-cache-layer", "mentions"),
    ("demo-cache-session", "demo-cache-task", "produced_by"),
]


def accessed(agent: str, op: str, ids: list[str], query: str = "") -> None:
    ev = {"type": "memory_accessed", "ts": time.time(), "op": op, "agent": agent, "ids": ids}
    if query:
        ev["query"] = query
    with open(cfg.events_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(ev) + "\n")


def main() -> None:
    print("demo: writing memories", flush=True)
    for type_, mid, title, body, agents in STORY:
        mem = memory.write_memory(cfg, type=type_, title=title, body=body, id=mid, agents=agents,
                                  projects=["demo"], tags=["demo"] + (["status:doing", "agent:codex"] if type_ == "task" else []))
        memory.upsert(conn, mem)
        accessed(agents[0], "write", [mid], title)
        time.sleep(STEP)
    for src, dst, kind in LINKS:
        memory.add_edge(conn, src, dst, kind)
        accessed("claude-code", "link", [src, dst])
        time.sleep(STEP)
    accessed("cursor", "search", [m[1] for m in STORY], "search cache")
    time.sleep(STEP)
    accessed("claude-code", "context", ["demo-cache-layer", "demo-cache-research"], "cache invalidation")
    time.sleep(STEP * 4)
    print("demo: cleaning up", flush=True)
    for type_, mid, *_ in STORY:
        (cfg.memories / type_ / f"{mid}.md").unlink(missing_ok=True)
        memory.delete_by_path(conn, cfg.memories / type_ / f"{mid}.md")
        time.sleep(0.4)
    hub = cfg.memories / "_projects" / "demo.md"
    hub.unlink(missing_ok=True)
    print("demo: done", flush=True)


if __name__ == "__main__":
    main()
