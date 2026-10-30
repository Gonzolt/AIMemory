---
id: markdown-is-source-of-truth
type: decision
title: Markdown files are the source of truth
created: 2026-10-30T18:49:05Z
updated: 2026-10-30T18:49:05Z
agents:
  - seed
projects:
  - aimemory
tags:
  - adr
  - architecture
status: active
confidence: high
links:
  - to: aimemory-overview
    kind: part_of
related:
  - "[[aimemory-overview]]"
hubs:
  - "[[_projects/aimemory]]"
---
**Context**
Several tools read and write the same memory; the index must never be the only copy.

**Decision**
Every memory is one markdown file with front-matter under `memories/<type>/<id>.md`. The SQLite index in `index/` is disposable and rebuilt with `aim index`.

**Consequences**
Hand edits are legal; the watcher picks them up. Git sync works on plain text.

**Alternatives considered**
- SQLite as primary store — rejected because it cannot be hand-edited or diffed
- A hosted vector DB — rejected because nothing should leave the machine
