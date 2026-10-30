# AIMemory · BoltraMemory

One shared, local memory for every AI tool you use. Claude Code, Codex CLI, Cursor and anything else that speaks MCP read and write the same hub, so you stop pasting the same background into every session.

- **Markdown is the source of truth.** Every memory is one file: `memories/<type>/<id>.md`. Hand edits are fine; the watcher picks them up.
- **The index is disposable.** `index/*.sqlite` (SQLite + FTS5) is gitignored and rebuilt with `aim index`.
- **Localhost only.** API on `127.0.0.1:5470`, dev UI on `127.0.0.1:5471`. Nothing leaves the machine unless you add a private git remote.
- **One MCP server, `aimemory`, 27 tools** over stdio.
- **Three ways to look at it:** a live 2D graph UI, a 3D "galaxy", and Obsidian (`memories/` is a vault).

The UI is branded **BoltraMemory**; the folder, CLI and MCP server are **AIMemory**, `aim` and `aimemory`.

## Install

Python 3.11+ and Node (pnpm, bun or npm).

```bash
git clone <your-private-remote> ~/Documents/AIMemory
bash ~/Documents/AIMemory/scripts/install.sh
```

The installer adds the Python deps, installs the UI deps, builds the indexes, registers `aimemory` in Claude Code (`~/.claude.json`), Codex (`~/.codex/config.toml`) and Cursor (`~/.cursor/mcp.json`) with `.bak` backups, and puts `aim` on your PATH (`~/.local/bin`; on Windows an `aim.cmd` shim). Restart the clients afterwards.

To wire the clients again later: `aim install-clients` (idempotent).

## Daily use

| Command | What it does |
|---|---|
| `aim start` / `aim stop` | Watcher + API in the background (logs and pids in `.aim/`) |
| `aim autostart on\|off` | Windows: run `aim start` hidden at every logon (a `.vbs` in the Startup folder). macOS: use `scripts/launchd/` |
| `aim graph` | Dev UI on http://localhost:5471 (starts the stack if needed) |
| `aim galaxy` | 3D galaxy at http://127.0.0.1:5470/galaxy.html |
| `aim status` | Counts, projects, ports |
| `aim search Q` · `aim recent` · `aim write TYPE TITLE --body …` | The hub from a terminal (for clients without MCP) |
| `aim index [--force]` | Rebuild the memory and code indexes |
| `aim sync [-m MSG]` · `aim snapshot` | Commit (+ pull/push with a remote) · dated tag |
| `aim brief` | Write today's morning brief to `memories/_briefs/` and `memories/Brief.md` |
| `aim scout` · `aim clean [--yes]` | Disk report / cleanup for git worktrees of `[brief].repos` |

After `pnpm --prefix graph run build` (or `npm --prefix graph run build`) the API serves the UI itself on http://127.0.0.1:5470.

## Memory types and links

Types: `user` (profile), `feedback` (standing rules), `project`, `reference`, `decision` (ADRs, post-mortems), `conversation` (session summaries), `code`, `task`.

Link kinds: `part_of`, `derived_from`, `supersedes`, `conflicts_with`, `mentions`, `produced_by`. Links live in the source file's front-matter; `related:` and `hubs:` are generated mirrors for Obsidian.

Tasks keep their state in tags: `status:todo|doing|done|blocked` and `agent:<name>`. Pin a memory (tag `pinned:true`, or right-click → Pin in the UI) to make it a standing rule every agent loads first through `memory_system_context`.

## MCP tools (27)

| Family | Tools |
|---|---|
| memory | `memory_search` `memory_read` `memory_recent` `memory_list` `memory_write` `memory_link` `memory_system_context` `memory_context` |
| code | `code_search` `code_read` `code_projects` |
| graph | `graph_overview` `graph_neighbors` `graph_path` `graph_hubs` |
| task | `task_create` `task_claim` `task_complete` `task_block` `task_list` `task_handoff` |
| agent | `agent_register` `agent_done` `agent_list` |
| templates | `template_list` `template_apply` |
| audit | `audit_query` |

`AGENTS.md` holds the instructions block for agents; put the same text in `~/.claude/CLAUDE.md` so Claude Code uses the hub by default.

## Layout

```
bin/aim                CLI
server/                config, db, schema.sql, memory, code_index, mcp_server, watcher, api, brief, cleanup, oscompat
scripts/               install.sh, install_clients.py, demo.py, seed_*.py, launchd/ templates
graph/                 React + Vite UI (index.html) and the galaxy (galaxy.html, galaxy/main.js)
memories/              the store, git-tracked, also the Obsidian vault "memories"
skills/                optional Claude Code skills: aimemory-recall, aimemory-snapshot
tests/acceptance.py    the rebuild spec's acceptance checks, run against a temp copy
index/  .aim/          gitignored: SQLite indexes, runtime state, events.jsonl
```

`config.toml` lists the code projects to index under `[[projects]]`; add yours there.

## Tests

```bash
python tests/acceptance.py
```

Runs 69 checks covering spec tests 1–19 and 21–23 against a throwaway copy on port 5480; your hub is not touched. Test 20 (the UI) is checked by hand.

## Notes on this build

Rebuilt from the AIMemory recreate spec. Where it departs from the spec:

- **mcp is pinned to `>=1.27,<2`.** mcp 2.x renamed FastMCP.
- **`websockets` is a dependency.** Plain uvicorn cannot upgrade `/ws` without it.
- **`server/oscompat.py` makes it run on Windows** (process checks, detached spawns, file locks). On Windows `os.kill(pid, 0)` would send Ctrl-C.
- **Fixed, as the spec invited:**
  - `reindex_all` tolerates links to missing ids.
  - The Codex installer also drops `[mcp_servers.aimemory.*]` sub-tables while keeping `tools.*` approvals.
  - Requests carrying `cf-connecting-ip` / `x-forwarded-for` count as remote, so the email allowlist works behind a local tunnel daemon.
  - `/stale` compares ISO-Z timestamps correctly.
  - `PUT /memory` with an explicit `[]` clears a list.
- **Kept, for parity:**
  - The agent registry is per process and expires after 5 minutes.
  - Task tools reset confidence and status.
  - An empty list in `memory_write` keeps the old list.
  - Explicit ids are not slugified.
  - `audit_query` returns the oldest `limit` matches in its window.
- **The galaxy sets a scene background.** The renderer's clear colour comes out grey through the bloom composer in three r186.
