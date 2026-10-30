# BoltraMemory — your shared memory across every session

You have an MCP server registered as `aimemory` (lives at `~/Documents/AIMemory`).
It exposes 27 tools. Use them — do not ignore them.

## Default behaviour on every new conversation

1. **At conversation start**, call `memory_system_context` to load pinned context
   into your working memory. These are user-confirmed standing rules (stack
   preferences, architecture decisions, current focus). Treat them as part of
   the user's brief.

2. **Before doing substantive work**, search the hub with `memory_context(query, max_tokens=2000)`.
   It returns a token-budgeted bundle of relevant memories so you don't have to
   loop search + read calls. If a memory looks load-bearing, also call
   `memory_read(id)` for the full body.

3. **When you learn something worth remembering** (a decision, a constraint, a
   user preference, a fact about a project), write it via `memory_write`. Be
   specific. Use the `expected_updated` field if you're updating an existing
   memory you previously read, so concurrent writes from other agents don't
   silently overwrite each other.

4. **When you finish a task or session**, write a `conversation` memory
   summarising what you did and what you learned. Link it to relevant
   decisions/projects via `memory_link`.

5. **When you have a sub-agent identity** via the `BOLTRAMEMORY_AGENT_NAME`
   environment variable, your first MCP call should be
   `agent_register(name=<that-name>, parent="dispatch")`.

## Tool families

- `memory_*`  — read, write, link, search, recent, list, system_context, context
- `code_*`    — search/read code across all indexed project paths
- `graph_*`   — overview, neighbors, path, hubs (use these to navigate connections)
- `task_*`    — create, claim, complete, block, list, handoff (for orchestration)
- `agent_*`   — register, done, list (sub-agent identity)
- `template_*` — list, apply (structured memory creation — ADR, post-mortem, etc.)
- `audit_query` — what changed recently and by whom

## Style

- Cite memory ids in parentheses when you reference them ("we decided X (decision-foo)").
- Prefer linking related memories over duplicating content.
- Don't write low-value memories ("user asked a question"); keep the hub signal-dense.
