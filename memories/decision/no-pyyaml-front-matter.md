---
id: no-pyyaml-front-matter
type: decision
title: Hand-written front-matter parser, no PyYAML
created: 2026-10-30T18:49:05Z
updated: 2026-10-30T18:49:05Z
agents:
  - seed
projects:
  - aimemory
tags:
  - adr
status: active
confidence: medium
links:
  - to: markdown-is-source-of-truth
    kind: derived_from
related:
  - "[[markdown-is-source-of-truth]]"
hubs:
  - "[[_projects/aimemory]]"
---
**Decision**
The front-matter reader/writer is a small hand-written YAML subset, so the only Python deps are mcp, httpx, watchdog, uvicorn and starlette.

**Consequences**
Key order and quoting are fixed by `Memory.to_markdown()`; other tools may rely on them.
