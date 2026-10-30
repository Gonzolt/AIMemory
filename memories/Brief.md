# Brief 2026-10-30

## The one move
Run aim install-clients and restart Claude Code, Codex and Cursor so the memory tools are callable everywhere (wire-mcp-clients).

## Since last brief
AIMemory was rebuilt from the spec in one session (2026-10-30-aimemory-rebuild), with the server, 27 MCP tools, CLI, API, UI and galaxy view. Eleven new memories landed. They include reference notes on the task lifecycle (task-lifecycle) and tool families (mcp-tool-families), plus three decisions: markdown files are the source of truth (markdown-is-source-of-truth), the API binds localhost only (localhost-only-api), and the front-matter parser is hand-written with no PyYAML (no-pyyaml-front-matter). The project overview (aimemory-overview) and the write-back rule (write-back-what-matters) are pinned.

## Open
Three tasks remain. Pinning your standing rules is in progress (pin-standing-rules). Registering aimemory in the three clients (wire-mcp-clients) and adding your code projects to config.toml (index-my-projects) are both still todo. The rebuild session left one open question about which code projects to index, and answering it unblocks the last task. No conflicts were detected.

## Code
No commits since the last brief, and no disk data was reported. Code search will not cover your projects until they are listed in config.toml and aim status shows them.

<!-- aim-brief generated=2026-10-30T18:49:17Z source=claude -->
