"""AIMemory MCP server (stdio). Exactly 27 tools.

Launched by each client as:  <python> -m server.mcp_server   with PYTHONPATH=<ROOT>
"""
from __future__ import annotations

import json
import os
import re
import time
from collections import deque
from typing import Any

from mcp.server.fastmcp import FastMCP

from server import code_index, config, db, memory

cfg = config.load()
db.init_schema(cfg.memory_db, cfg.code_db)
mconn = db.connect(cfg.memory_db)
cconn = db.connect(cfg.code_db)
memory.reindex_all(cfg, mconn)

mcp = FastMCP("aimemory", log_level="WARNING")

# In-process agent registry. Every client spawns its own stdio server, so
# registrations are not shared across clients.
_AGENTS: dict[str, dict] = {}
_LAST_AGENT: list[str] = []


# --------------------------------------------------------------------------- activity feed

def _agent_name() -> str:
    env = os.environ.get("BOLTRAMEMORY_AGENT_NAME")
    if env:
        return env
    if _LAST_AGENT:
        return _LAST_AGENT[-1]
    try:
        info = mcp.get_context().session.client_params.clientInfo
        if info and info.name:
            return info.name
    except Exception:
        pass
    return "agent"


def _activity(op: str, ids: list[str], query: str | None = None) -> None:
    ids = list(dict.fromkeys(i for i in ids if i))[:24]
    if not ids:
        return
    ev: dict[str, Any] = {"type": "memory_accessed", "ts": time.time(), "op": op, "agent": _agent_name(), "ids": ids}
    if query:
        ev["query"] = query[:160]
    try:
        cfg.events_path.parent.mkdir(parents=True, exist_ok=True)
        with open(cfg.events_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(ev, ensure_ascii=False) + "\n")
    except OSError:
        pass


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"\w+", text.lower()) if len(w) > 2}


def _suggest_links(mid: str, title: str, body: str) -> list[dict]:
    try:
        mine = _words(f"{title} {body}")
        if len(mine) < 8:
            return []
        scored = []
        for other in memory.list_all(mconn, limit=600):
            if other["id"] == mid:
                continue
            theirs = _words(f"{other['title']} {other['body']}")
            if len(theirs) < 8:
                continue
            sim = len(mine & theirs) / len(mine | theirs)
            if sim >= 0.18:
                scored.append({"id": other["id"], "title": other["title"], "similarity": round(sim, 3)})
        scored.sort(key=lambda x: -x["similarity"])
        return scored[:3]
    except Exception:
        return []


# --------------------------------------------------------------------------- memory family

@mcp.tool()
def memory_search(query: str, type: str | None = None, project: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    """Full-text search over memories (title weighted 4x body). FTS5 syntax allowed.
    Empty query returns the most recent memories."""
    hits = memory.search(mconn, query, type=type, project=project, limit=limit)
    _activity("search", [h["id"] for h in hits], query)
    return hits


@mcp.tool()
def memory_read(id: str) -> dict[str, Any] | None:
    """Read one memory by id (full body and metadata). Returns null if not found."""
    m = memory.get(mconn, id)
    if m:
        _activity("read", [id])
    return m


@mcp.tool()
def memory_recent(n: int = 10) -> list[dict[str, Any]]:
    """The n most recently updated memories."""
    return memory.recent(mconn, n)


@mcp.tool()
def memory_list(type: str | None = None, project: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
    """List memories, newest first, optionally filtered by type and/or project."""
    return memory.list_all(mconn, type=type, project=project, limit=limit)


@mcp.tool()
def memory_write(
    type: str,
    title: str,
    body: str,
    id: str | None = None,
    agents: list[str] | None = None,
    projects: list[str] | None = None,
    tags: list[str] | None = None,
    confidence: str = "medium",
    status: str = "active",
    expected_updated: str | None = None,
) -> dict[str, Any]:
    """Create or overwrite a memory (markdown file + index).
    type: user|feedback|project|reference|decision|conversation|code|task.
    Pass id + expected_updated (the `updated` you read) to get a conflict instead of
    silently overwriting a newer write from another agent."""
    if id and expected_updated:
        cur = memory.get(mconn, id)
        if cur and cur["updated"] > expected_updated:
            return {
                "status": "conflict",
                "id": id,
                "their_updated": cur["updated"],
                "your_expected": expected_updated,
                "their_body": cur["body"],
                "their_title": cur["title"],
                "hint": "Re-read the memory, merge with your changes, then call memory_write again with the new expected_updated.",
            }
    mem = memory.write_memory(
        cfg, type=type, title=title, body=body, id=id, agents=agents, projects=projects,
        tags=tags, confidence=confidence, status=status,
    )
    memory.upsert(mconn, mem)
    _activity("write", [mem.id], title)
    return {
        "status": "ok",
        "id": mem.id,
        "type": mem.type,
        "title": mem.title,
        "path": str(mem.path),
        "updated": mem.updated,
        "suggested_links": _suggest_links(mem.id, mem.title, mem.body),
    }


@mcp.tool()
def memory_link(src: str, dst: str, kind: str = "mentions") -> dict[str, Any]:
    """Link two memories. kind: part_of|derived_from|supersedes|conflicts_with|mentions|produced_by.
    The edge is persisted into the src memory's file."""
    ok = memory.add_edge(mconn, src, dst, kind)
    if ok:
        _activity("link", [src, dst])
    return {"ok": ok, "src": src, "dst": dst, "kind": kind}


def _pinned(m: dict) -> bool:
    return "pinned:true" in m["tags"] or "pinned" in m["tags"]


@mcp.tool()
def memory_system_context() -> dict[str, Any]:
    """Pinned memories as one markdown bundle. Call at conversation start: these are
    the user's standing rules and current focus."""
    pinned = [m for m in memory.list_all(mconn, limit=500) if _pinned(m)]
    if not pinned:
        return {"count": 0, "markdown": "(no pinned memories — pin some in the UI to populate this bundle)"}
    parts = ["# System context — pinned memories\n"]
    for m in pinned:
        parts.append(f"## {m['title']}\n_type: {m['type']} · id: {m['id']}_\n\n{m['body'].rstrip()}\n")
    _activity("context", [m["id"] for m in pinned], "pinned")
    return {"count": len(pinned), "markdown": "\n".join(parts)}


@mcp.tool()
def memory_context(query: str, max_tokens: int = 4000) -> dict[str, Any]:
    """Token-budgeted bundle of the memories most relevant to `query` (~4 chars/token).
    Use instead of looping search + read."""
    budget = max(200, max_tokens * 4)
    used, blocks, ids = 0, [], []
    for h in memory.search(mconn, query, limit=30):
        block = f"## {h['title']}\n_id: {h['id']} · type: {h['type']}_\n" + h["body"].rstrip() + "\n\n"
        if blocks and used + len(block) > budget:
            break
        blocks.append(block)
        ids.append(h["id"])
        used += len(block)
    _activity("context", ids, query)
    return {"used_tokens": used // 4, "included_ids": ids, "markdown": "".join(blocks) or "(no matches)"}


# --------------------------------------------------------------------------- code family

@mcp.tool()
def code_search(query: str, project: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    """Full-text search over the code of every indexed project. Returns path + line range."""
    return code_index.search(cconn, query, project=project, limit=limit)


@mcp.tool()
def code_read(path: str, line_start: int | None = None, line_end: int | None = None) -> str:
    """Read a file from disk (always fresh). Optional 1-based inclusive line range."""
    return code_index.read(path, line_start, line_end)


@mcp.tool()
def code_projects() -> list[dict[str, Any]]:
    """Configured code projects with file counts, bytes and languages."""
    return code_index.project_summary(cconn, cfg)


# --------------------------------------------------------------------------- graph family

def _adjacency() -> dict[str, list[tuple[str, str]]]:
    adj: dict[str, list[tuple[str, str]]] = {}
    for e in memory.edges(mconn):
        adj.setdefault(e["src"], []).append((e["dst"], e["kind"]))
        adj.setdefault(e["dst"], []).append((e["src"], e["kind"]))
    return adj


def _hubs(top: int) -> list[dict]:
    deg: dict[str, int] = {}
    for e in memory.edges(mconn):
        deg[e["src"]] = deg.get(e["src"], 0) + 1
        deg[e["dst"]] = deg.get(e["dst"], 0) + 1
    out = []
    for mid, d in sorted(deg.items(), key=lambda kv: (-kv[1], kv[0])):
        m = memory.get(mconn, mid)
        if m:
            out.append({"id": mid, "title": m["title"], "type": m["type"], "degree": d})
        if len(out) >= top:
            break
    return out


@mcp.tool()
def graph_overview() -> dict[str, Any]:
    """Counts by type and edge kind, plus the 10 most connected memories."""
    by_type = {r["type"]: r["n"] for r in mconn.execute(
        "SELECT type, COUNT(*) AS n FROM memories WHERE status='active' GROUP BY type ORDER BY n DESC")}
    kinds = {r["kind"]: r["n"] for r in mconn.execute("SELECT kind, COUNT(*) AS n FROM edges GROUP BY kind ORDER BY n DESC")}
    n_edges = mconn.execute("SELECT COUNT(*) FROM edges").fetchone()[0]
    return {"memories": sum(by_type.values()), "edges": n_edges, "by_type": by_type, "edge_kinds": kinds, "hubs": _hubs(10)}


@mcp.tool()
def graph_neighbors(id: str, depth: int = 1, limit: int = 50) -> dict[str, Any]:
    """Memories within `depth` hops (1..5) of `id`, with the edges walked."""
    if not memory.get(mconn, id):
        return {"error": "not_found"}
    depth = max(1, min(5, depth))
    adj = _adjacency()
    visited = [id]
    seen = {id}
    edges_out: list[dict] = []
    frontier = deque([(id, 0)])
    while frontier and len(visited) < limit:
        cur, d = frontier.popleft()
        if d >= depth:
            continue
        for nb, kind in adj.get(cur, []):
            if nb in seen:
                continue
            if len(visited) >= limit:
                break
            seen.add(nb)
            visited.append(nb)
            edges_out.append({"src": cur, "dst": nb, "kind": kind})
            frontier.append((nb, d + 1))
    nodes = []
    for mid in visited:
        m = memory.get(mconn, mid)
        if m:
            nodes.append({"id": mid, "title": m["title"], "type": m["type"], "tags": m["tags"]})
    return {"center": id, "depth": depth, "nodes": nodes, "edges": edges_out}


@mcp.tool()
def graph_path(from_id: str, to_id: str, max_hops: int = 6) -> dict[str, Any]:
    """Shortest path between two memories (undirected), up to max_hops."""
    if from_id == to_id:
        return {"path": [from_id], "edges": []}
    if not memory.get(mconn, from_id) or not memory.get(mconn, to_id):
        return {"error": "endpoint_not_found"}
    adj = _adjacency()
    parent: dict[str, tuple[str, str]] = {}
    seen = {from_id}
    frontier = deque([(from_id, 0)])
    while frontier:
        cur, d = frontier.popleft()
        if cur == to_id:
            break
        if d >= max_hops:
            continue
        for nb, kind in adj.get(cur, []):
            if nb not in seen:
                seen.add(nb)
                parent[nb] = (cur, kind)
                frontier.append((nb, d + 1))
    if to_id not in parent:
        return {"path": [], "edges": [], "note": "no_path_within_max_hops"}
    path, edges_out = [to_id], []
    node = to_id
    while node != from_id:
        prev, kind = parent[node]
        edges_out.append({"src": prev, "dst": node, "kind": kind})
        path.append(prev)
        node = prev
    path.reverse()
    edges_out.reverse()
    return {"path": path, "edges": edges_out, "hops": len(path) - 1}


@mcp.tool()
def graph_hubs(top: int = 10) -> list[dict[str, Any]]:
    """The most connected memories by edge degree."""
    return _hubs(top)


# --------------------------------------------------------------------------- task family

def _task_status(tags: list[str]) -> str:
    for t in tags:
        if t.startswith("status:"):
            return t.split(":", 1)[1]
    return "todo"


def _task_agent(tags: list[str]) -> str | None:
    for t in tags:
        if t.startswith("agent:"):
            return t.split(":", 1)[1]
    return None


def _rewrite_task(m: dict, *, tags: list[str], body: str | None = None, agents: list[str] | None = None) -> None:
    mem = memory.write_memory(
        cfg, type=m["type"], title=m["title"], body=m["body"] if body is None else body, id=m["id"],
        agents=agents if agents is not None else m["agents"], projects=m["projects"], tags=tags,
    )
    memory.upsert(mconn, mem)


@mcp.tool()
def task_create(
    title: str,
    body: str = "",
    assigned_to: str | None = None,
    depends_on: list[str] | None = None,
    projects: list[str] | None = None,
    tags: list[str] | None = None,
) -> dict[str, Any]:
    """Create a task (a memory of type task). Dependencies become derived_from edges."""
    t = list(tags or []) + ["status:todo"]
    if assigned_to:
        t.append(f"agent:{assigned_to}")
    mem = memory.write_memory(
        cfg, type="task", title=title, body=body, agents=[assigned_to] if assigned_to else None,
        projects=projects, tags=t,
    )
    memory.upsert(mconn, mem)
    for dep in depends_on or []:
        if memory.get(mconn, dep):
            memory_link(mem.id, dep, "derived_from")
    return {"id": mem.id, "status": "todo", "assigned_to": assigned_to}


@mcp.tool()
def task_claim(id: str, agent: str) -> dict[str, Any]:
    """Claim a task: status doing, assigned to `agent`."""
    m = memory.get(mconn, id)
    if not m:
        return {"ok": False, "error": "not_found"}
    tags = [t for t in m["tags"] if not t.startswith(("status:", "agent:"))] + ["status:doing", f"agent:{agent}"]
    agents = list(dict.fromkeys(m["agents"] + [agent]))
    _rewrite_task(m, tags=tags, agents=agents)
    return {"ok": True, "id": id, "status": "doing", "assigned_to": agent}


@mcp.tool()
def task_complete(id: str, result_summary: str | None = None) -> dict[str, Any]:
    """Mark a task done, optionally appending a result summary to its body."""
    m = memory.get(mconn, id)
    if not m:
        return {"ok": False, "error": "not_found"}
    tags = [t for t in m["tags"] if not t.startswith("status:")] + ["status:done"]
    body = m["body"]
    if result_summary:
        body = body.rstrip() + f"\n\n---\n**Completed:** {result_summary}\n"
    _rewrite_task(m, tags=tags, body=body)
    return {"ok": True, "id": id, "status": "done"}


@mcp.tool()
def task_block(id: str, reason: str) -> dict[str, Any]:
    """Mark a task blocked with a reason."""
    m = memory.get(mconn, id)
    if not m:
        return {"ok": False, "error": "not_found"}
    tags = [t for t in m["tags"] if not t.startswith("status:")] + ["status:blocked"]
    _rewrite_task(m, tags=tags, body=m["body"].rstrip() + f"\n\n**Blocked:** {reason}\n")
    return {"ok": True, "id": id, "status": "blocked"}


@mcp.tool()
def task_list(status: str | None = None, agent: str | None = None) -> list[dict[str, Any]]:
    """List tasks, optionally filtered by status (todo|doing|done|blocked) and agent."""
    out = []
    for m in memory.list_all(mconn, type="task", limit=500):
        st, ag = _task_status(m["tags"]), _task_agent(m["tags"])
        if status and st != status:
            continue
        if agent and ag != agent:
            continue
        out.append({"id": m["id"], "title": m["title"], "body": m["body"], "status": st,
                    "assigned_to": ag, "projects": m["projects"], "updated": m["updated"]})
    return out


@mcp.tool()
def task_handoff(task_id: str, to_agent: str, message: str) -> dict[str, Any]:
    """Hand a task to another agent: back to todo, assigned to `to_agent`, with a note."""
    m = memory.get(mconn, task_id)
    if not m:
        return {"ok": False, "error": "not_found"}
    tags = [t for t in m["tags"] if not t.startswith(("status:", "agent:"))] + ["status:todo", f"agent:{to_agent}"]
    body = m["body"].rstrip() + f"\n\n---\n**Handoff** → `{to_agent}`\n{message}\n"
    _rewrite_task(m, tags=tags, body=body, agents=list(dict.fromkeys(m["agents"] + [to_agent])))
    return {"ok": True, "task_id": task_id, "to": to_agent}


# --------------------------------------------------------------------------- agent family

@mcp.tool()
def agent_register(name: str, parent: str | None = None, capabilities: list[str] | None = None) -> dict[str, Any]:
    """Register this session's agent identity (sub-agents: name from BOLTRAMEMORY_AGENT_NAME)."""
    now = time.time()
    rec = {"name": name, "parent": parent, "capabilities": list(capabilities or []), "started_at": now, "last_seen": now}
    _AGENTS[name] = rec
    _LAST_AGENT.append(name)
    return rec


@mcp.tool()
def agent_done(name: str, summary: str | None = None) -> dict[str, Any]:
    """Release an agent identity; with a summary, write it as a conversation memory."""
    had = _AGENTS.pop(name, None) is not None
    if summary:
        mem = memory.write_memory(cfg, type="conversation", title=f"{name}: session summary", body=summary, agents=[name])
        memory.upsert(mconn, mem)
    return {"ok": True, "released": name, "had_session": had}


@mcp.tool()
def agent_list() -> list[dict[str, Any]]:
    """Agents registered in this server process within the last 5 minutes."""
    now = time.time()
    return [a for a in _AGENTS.values() if now - a["last_seen"] < 300]


# --------------------------------------------------------------------------- templates

_TEMPLATES = {
    "adr": {"type": "decision", "title_hint": "Use X for Y",
            "body": "**Context**\n…\n\n**Decision**\n…\n\n**Consequences**\n…\n\n**Alternatives considered**\n- A — rejected because …\n- B — rejected because …",
            "tags": ["adr"]},
    "postmortem": {"type": "decision", "title_hint": "Post-mortem: …",
                   "body": "**Symptom**\n…\n\n**Root cause**\n…\n\n**Fix**\n…\n\n**Prevention**\n…",
                   "tags": ["bug", "post-mortem"]},
    "task": {"type": "task", "title_hint": "Short imperative goal",
             "body": "**Goal**\n…\n\n**Context**\n…\n\n**Acceptance**\n- [ ] …",
             "tags": ["status:todo"]},
    "research": {"type": "reference", "title_hint": "Research: …",
                 "body": "**Question**\n…\n\n**Sources**\n- …\n\n**Findings**\n…\n\n**Implications**\n…",
                 "tags": ["research"]},
    "session-summary": {"type": "conversation", "title_hint": "Session: <agent> on <topic>",
                        "body": "**Goal**\n…\n\n**What I did**\n- …\n\n**What I learned**\n- …\n\n**Open questions**\n- …",
                        "tags": ["session"]},
}


@mcp.tool()
def template_list() -> list[dict[str, Any]]:
    """Structured memory templates (ADR, post-mortem, task, research, session summary)."""
    return [{"id": k, **v} for k, v in _TEMPLATES.items()]


@mcp.tool()
def template_apply(template_id: str, title: str, fields: dict | None = None) -> dict[str, Any]:
    """Create a memory from a template. fields maps section names (e.g. "Decision") to
    text; "_body" replaces the whole body."""
    tpl = _TEMPLATES.get(template_id)
    if not tpl:
        return {"error": f"unknown template: {template_id}"}
    fields = fields or {}
    body = tpl["body"]
    if fields.get("_body"):
        body = str(fields["_body"])
    else:
        for k, v in fields.items():
            body = body.replace(f"**{k}**\n…", f"**{k}**\n{v}", 1)
    mem = memory.write_memory(cfg, type=tpl["type"], title=title, body=body, tags=list(tpl["tags"]))
    memory.upsert(mconn, mem)
    return {"id": mem.id, "title": mem.title, "type": mem.type}


# --------------------------------------------------------------------------- audit

@mcp.tool()
def audit_query(since_minutes: int = 60, agent: str | None = None, event_type: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    """Recent events from the audit log (memory_changed/deleted, code_*, memory_accessed)."""
    try:
        lines = cfg.events_path.read_text(encoding="utf-8").splitlines()[-2000:]
    except OSError:
        return []
    cutoff = time.time() - since_minutes * 60
    out: list[dict] = []
    for line in lines:
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("ts", 0) < cutoff:
            continue
        if event_type and ev.get("type") != event_type:
            continue
        if agent and "id" in ev:
            m = memory.get(mconn, ev["id"])
            if not m or agent not in m["agents"]:
                continue
        out.append(ev)
        if len(out) >= limit:
            break
    return list(reversed(out))


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
