---
id: task-lifecycle
type: reference
title: Task lifecycle and dispatch
created: 2026-10-30T18:49:05Z
updated: 2026-10-30T18:49:05Z
agents:
  - seed
projects:
  - aimemory
tags:
  - orchestration
status: active
confidence: high
links:
  - to: mcp-tool-families
    kind: mentions
related:
  - "[[mcp-tool-families]]"
hubs:
  - "[[_projects/aimemory]]"
---
Tasks are memories of type `task`; their status lives in tags (`status:todo|doing|done|blocked`, `agent:<name>`). `todo → doing` via task_claim or POST /dispatch, then `done` via task_complete or `blocked` via task_block. task_handoff returns a task to todo for another agent. Dependencies are `derived_from` edges from the task to its prerequisites.
