---
id: localhost-only-api
type: decision
title: The API binds localhost only
created: 2026-10-30T18:49:05Z
updated: 2026-10-30T18:49:05Z
agents:
  - seed
projects:
  - aimemory
tags:
  - adr
  - security
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
**Decision**
The HTTP API binds `127.0.0.1:5470` and the Vite dev server `127.0.0.1:5471`. An email allowlist and a rate limit exist only for an optional tunnel and are bypassed for loopback.
