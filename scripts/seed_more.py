"""Optional second seed: an example task board and a session summary.

    python scripts/seed_more.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server import config, db, memory  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # ✓ on Windows consoles

cfg = config.load()
db.init_schema(cfg.memory_db, cfg.code_db)
conn = db.connect(cfg.memory_db)

TASKS = [
    ("index-my-projects", "Add my code projects to config.toml",
     "**Goal**\nList every code project under `[[projects]]` so code_search covers them.\n\n**Acceptance**\n- [ ] `aim status` shows them", "todo"),
    ("wire-mcp-clients", "Register aimemory in Claude Code, Codex and Cursor",
     "**Goal**\nRun `aim install-clients` and restart the clients.\n\n**Acceptance**\n- [ ] `memory_system_context` is callable", "todo"),
    ("pin-standing-rules", "Pin my standing rules",
     "**Goal**\nPin the feedback memories every agent should load at session start.", "doing"),
]


def main() -> None:
    for mid, title, body, status in TASKS:
        mem = memory.write_memory(cfg, type="task", id=mid, title=title, body=body, projects=["aimemory"],
                                  agents=["seed"], tags=[f"status:{status}"])
        memory.upsert(conn, mem)
        print(f"✓ task {mid} ({status})")
    mem = memory.write_memory(
        cfg, type="conversation", id="2026-10-30-aimemory-rebuild", title="Session: rebuilt AIMemory from the spec",
        body="**Goal**\nRebuild AIMemory 1:1 from the recreate prompt.\n\n**What I did**\n- Server, 27 MCP tools, CLI, API, UI, galaxy\n\n"
             "**Open questions**\n- Which code projects to index",
        projects=["aimemory"], agents=["claude-code"], tags=["session"],
    )
    memory.upsert(conn, mem)
    if memory.get(conn, "aimemory-overview"):  # created by seed_memories.py
        for mid, *_ in TASKS:
            memory.add_edge(conn, mid, "aimemory-overview", "part_of")
        memory.add_edge(conn, mem.id, "aimemory-overview", "produced_by")
    print(f"✓ conversation {mem.id}")


if __name__ == "__main__":
    main()
