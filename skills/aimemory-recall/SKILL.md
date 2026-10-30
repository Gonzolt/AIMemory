---
name: aimemory-recall
description: Recall what the shared AIMemory hub knows about a topic — pinned rules, the most relevant memories and their graph neighbours — and answer with a short cited brief. Use when the user asks "what do we know about X", "what did we decide about X", "remind me about X", or before starting work on a topic that may have history.
---

# aimemory-recall

Answer from the `aimemory` MCP server, not from guesswork.

1. In parallel, call `memory_system_context()` and `memory_search(query=<topic>, limit=8)`.
2. Take the top hit and call `graph_neighbors(id=<top hit>, depth=1, limit=15)` to see what it connects to.
3. Call `memory_read(id)` on up to 3 memories that look load-bearing (decisions, feedback rules, the project note).
4. Answer in the user's language with a short brief:
   - what is decided or known, each claim followed by its memory id in parentheses
   - open questions or conflicts (`conflicts_with` edges, low-confidence memories)
   - nothing invented: if the hub has nothing, say so plainly and offer to write a memory.
