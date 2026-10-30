---
name: aimemory-snapshot
description: Give a quick state-of-the-hub summary of AIMemory — totals, counts by type and edge kind, the most recent memories and the biggest hubs — straight from the local SQLite index. Use when the user asks "how is my memory hub doing", "what's in AIMemory", "show me the hub stats", or wants a snapshot before a sync.
---

# aimemory-snapshot

Run the bundled script (read-only; it opens the index with `mode=ro`):

```bash
python ~/.claude/skills/aimemory-snapshot/scripts/snapshot.py
```

It prints JSON: `{totals, by_type, edge_kinds, recent, top_hubs}`. Render it as a short summary:
one line of totals, the type mix, the 5 newest memories with ids, and the 3 biggest hubs.
If the index file is missing, tell the user to run `aim index`.
