"""Seed the hub with memories about AIMemory itself, so a fresh install has a graph.

    python scripts/seed_memories.py

Safe to re-run: ids are fixed, so it overwrites its own notes only.
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

P = ["aimemory"]
SEEDS = [
    dict(type="project", id="aimemory-overview", title="AIMemory: one shared local memory for every AI tool",
         body="AIMemory (UI name BoltraMemory) gives Claude Code, Codex CLI, Cursor and any other MCP client one shared, "
              "local memory. Agents pull context through 27 MCP tools, write back decisions and session summaries, and "
              "link them into a graph you can browse in the 2D graph UI, the 3D galaxy or Obsidian.\n\n"
              "Root: `~/Documents/AIMemory`. CLI: `aim`. MCP server: `aimemory`.",
         tags=["pinned:true", "overview"], confidence="high"),
    dict(type="decision", id="markdown-is-source-of-truth", title="Markdown files are the source of truth",
         body="**Context**\nSeveral tools read and write the same memory; the index must never be the only copy.\n\n"
              "**Decision**\nEvery memory is one markdown file with front-matter under `memories/<type>/<id>.md`. "
              "The SQLite index in `index/` is disposable and rebuilt with `aim index`.\n\n"
              "**Consequences**\nHand edits are legal; the watcher picks them up. Git sync works on plain text.\n\n"
              "**Alternatives considered**\n- SQLite as primary store — rejected because it cannot be hand-edited or diffed\n"
              "- A hosted vector DB — rejected because nothing should leave the machine",
         tags=["adr", "architecture"], confidence="high"),
    dict(type="decision", id="localhost-only-api", title="The API binds localhost only",
         body="**Decision**\nThe HTTP API binds `127.0.0.1:5470` and the Vite dev server `127.0.0.1:5471`. "
              "An email allowlist and a rate limit exist only for an optional tunnel and are bypassed for loopback.",
         tags=["adr", "security"], confidence="high"),
    dict(type="decision", id="no-pyyaml-front-matter", title="Hand-written front-matter parser, no PyYAML",
         body="**Decision**\nThe front-matter reader/writer is a small hand-written YAML subset, so the only Python "
              "deps are mcp, httpx, watchdog, uvicorn and starlette.\n\n**Consequences**\nKey order and quoting are "
              "fixed by `Memory.to_markdown()`; other tools may rely on them.",
         tags=["adr"], confidence="medium"),
    dict(type="feedback", id="write-back-what-matters", title="Write back decisions and session summaries, not chatter",
         body="Agents should write a memory when they learn a decision, constraint, preference or project fact, and a "
              "`conversation` memory at the end of a session. Do not write low-value memories such as "
              "'user asked a question'. Prefer linking over duplicating.",
         tags=["pinned:true", "agents"], confidence="high"),
    dict(type="reference", id="mcp-tool-families", title="MCP tool families exposed by aimemory",
         body="- `memory_*` — search, read, recent, list, write, link, system_context, context\n"
              "- `code_*` — search, read, projects\n- `graph_*` — overview, neighbors, path, hubs\n"
              "- `task_*` — create, claim, complete, block, list, handoff\n- `agent_*` — register, done, list\n"
              "- `template_*` — list, apply\n- `audit_query`",
         tags=["mcp"], confidence="high"),
    dict(type="reference", id="task-lifecycle", title="Task lifecycle and dispatch",
         body="Tasks are memories of type `task`; their status lives in tags (`status:todo|doing|done|blocked`, "
              "`agent:<name>`). `todo → doing` via task_claim or POST /dispatch, then `done` via task_complete or "
              "`blocked` via task_block. task_handoff returns a task to todo for another agent. Dependencies are "
              "`derived_from` edges from the task to its prerequisites.",
         tags=["orchestration"], confidence="high"),
]
LINKS = [
    ("markdown-is-source-of-truth", "aimemory-overview", "part_of"),
    ("localhost-only-api", "aimemory-overview", "part_of"),
    ("no-pyyaml-front-matter", "markdown-is-source-of-truth", "derived_from"),
    ("write-back-what-matters", "aimemory-overview", "mentions"),
    ("mcp-tool-families", "aimemory-overview", "part_of"),
    ("task-lifecycle", "mcp-tool-families", "mentions"),
]


def main() -> None:
    for s in SEEDS:
        mem = memory.write_memory(cfg, projects=P, agents=["seed"], **s)
        memory.upsert(conn, mem)
        print(f"✓ {mem.type:<10} {mem.id}")
    for src, dst, kind in LINKS:
        memory.add_edge(conn, src, dst, kind)
    print(f"✓ {len(LINKS)} links")


if __name__ == "__main__":
    main()
