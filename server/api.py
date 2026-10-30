"""HTTP + WebSocket API for the graph UI and galaxy.  python -m server.api

Binds 127.0.0.1:5470. Every route is mounted at / and under /api. In production
it also serves the built UI from graph/dist.
"""
from __future__ import annotations

import asyncio
import io
import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket, WebSocketDisconnect

from server import code_index, config, db, memory
from server.oscompat import detached_kwargs, pid_alive, terminate

cfg = config.load()
db.init_schema(cfg.memory_db, cfg.code_db)
mconn = db.connect(cfg.memory_db)
cconn = db.connect(cfg.code_db)
memory.reindex_all(cfg, mconn)

DIST = cfg.root / "graph" / "dist"
AIM = cfg.aim_dir
AIM.mkdir(parents=True, exist_ok=True)

_subscribers: set[asyncio.Queue] = set()


# --------------------------------------------------------------------------- helpers

def _json(data, status: int = 200) -> JSONResponse:
    return JSONResponse(data, status_code=status)


async def _body(request: Request) -> dict | None:
    try:
        data = await request.json()
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _append_event(ev: dict) -> None:
    with open(cfg.events_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(ev, ensure_ascii=False) + "\n")


def _tail_lines(path: Path, n: int) -> list[str]:
    try:
        with open(path, "rb") as f:
            return [l.decode("utf-8", "ignore") for l in deque(f, maxlen=n)]
    except OSError:
        return []


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"\w+", text.lower()) if len(w) > 2}


def _token_sets(limit: int) -> list[tuple[dict, set[str]]]:
    out = []
    for m in memory.list_all(mconn, limit=limit):
        ws = _words(f"{m['title']} {m['body']}")
        if len(ws) >= 8:
            out.append((m, ws))
    return out


def _brief(m: dict) -> dict:
    return {"id": m["id"], "title": m["title"], "type": m["type"]}


def _set_status_tag(m: dict, status: str, runner: str | None = None, append: str | None = None, add_agent: str | None = None):
    tags = [t for t in m["tags"] if not t.startswith("status:")] + [f"status:{status}"]
    if runner and not any(t.startswith("agent:") for t in tags):
        tags.append(f"agent:{runner}")
    agents = list(dict.fromkeys(m["agents"] + ([add_agent] if add_agent else [])))
    body = m["body"].rstrip() + append if append else m["body"]
    mem = memory.write_memory(
        cfg, type=m["type"], title=m["title"], body=body, id=m["id"], agents=agents, projects=m["projects"],
        tags=tags, confidence=m["confidence"], status=m["status"],
    )
    memory.upsert(mconn, mem)


# --------------------------------------------------------------------------- core routes

async def health(request: Request):
    return _json({"ok": True})


async def graph(request: Request):
    return _json({"nodes": memory.list_all(mconn, limit=10000), "edges": memory.edges(mconn)})


async def memory_get(request: Request):
    m = memory.get(mconn, request.path_params["id"])
    return _json(m) if m else _json({"error": "not_found"}, 404)


async def memory_post(request: Request):
    d = await _body(request)
    if d is None:
        return _json({"error": "invalid json"}, 400)
    try:
        mem = memory.write_memory(
            cfg, type=d.get("type", ""), title=d.get("title") or "untitled", body=d.get("body", ""), id=d.get("id"),
            agents=d.get("agents") or ["ui"], projects=d.get("projects"), tags=d.get("tags"),
            confidence=d.get("confidence", "medium"), status=d.get("status", "active"),
        )
    except ValueError as e:
        return _json({"error": str(e)}, 400)
    memory.upsert(mconn, mem)
    return _json({"id": mem.id, "type": mem.type, "title": mem.title, "path": str(mem.path), "updated": mem.updated})


async def memory_put(request: Request):
    mid = request.path_params["id"]
    m = memory.get(mconn, mid)
    if not m:
        return _json({"error": "not_found"}, 404)
    d = await _body(request)
    if d is None:
        return _json({"error": "invalid json"}, 400)
    cur = memory.load_file(m["path"])
    links = cur.links if cur else []
    try:
        mem = memory.write_memory(
            cfg, type=d.get("type", m["type"]), title=d.get("title", m["title"]), body=d.get("body", m["body"]), id=mid,
            agents=d.get("agents", m["agents"]), projects=d.get("projects", m["projects"]), tags=d.get("tags", m["tags"]),
            links=links, confidence=d.get("confidence", m["confidence"]), status=d.get("status", m["status"]),
        )
    except ValueError as e:
        return _json({"error": str(e)}, 400)
    # write_memory keeps the old list for an empty one; an explicit [] from the UI means "clear"
    changed = False
    for key in ("agents", "projects", "tags"):
        if key in d and d[key] == [] and getattr(mem, key):
            setattr(mem, key, [])
            changed = True
    if changed:
        memory.save(mem)
    memory.upsert(mconn, mem)
    return _json({"ok": True, "id": mid, "updated": mem.updated})


async def memory_delete(request: Request):
    mid = request.path_params["id"]
    m = memory.get(mconn, mid)
    if not m:
        return _json({"error": "not_found"}, 404)
    # On Windows the unlink fails while another process (the watcher) has the file open; retry briefly.
    for attempt in range(10):
        try:
            Path(m["path"]).unlink(missing_ok=True)
            break
        except PermissionError:
            if attempt == 9:
                return _json({"error": "file is locked by another process; try again"}, 409)
            await asyncio.sleep(0.1)
    mconn.execute("DELETE FROM memories_fts WHERE id=?", (mid,))
    mconn.execute("DELETE FROM memories WHERE id=?", (mid,))
    return _json({"ok": True, "id": mid})


async def link(request: Request):
    d = await _body(request)
    if not d or not d.get("src") or not d.get("dst"):
        return _json({"error": "src and dst required"}, 400)
    kind = d.get("kind") or "mentions"
    if kind not in memory.VALID_EDGE_KINDS:
        return _json({"error": f"invalid kind: {kind}"}, 400)
    if not memory.add_edge(mconn, d["src"], d["dst"], kind):
        return _json({"error": "one or both memories not found"}, 404)
    return _json({"ok": True, "src": d["src"], "dst": d["dst"], "kind": kind})


async def search(request: Request):
    q = request.query_params
    return _json({"results": memory.search(mconn, q.get("q", ""), type=q.get("type") or None,
                                           project=q.get("project") or None, limit=int(q.get("limit", 20)))})


async def projects(request: Request):
    return _json({"projects": code_index.project_summary(cconn, cfg)})


async def code_search(request: Request):
    q = request.query_params
    return _json({"results": code_index.search(cconn, q.get("q", ""), project=q.get("project") or None,
                                               limit=int(q.get("limit", 20)))})


async def duplicates(request: Request):
    thr = float(request.query_params.get("threshold", 0.55))
    items = _token_sets(2000)
    pairs = []
    for i in range(len(items)):
        a, wa = items[i]
        for j in range(i + 1, len(items)):
            b, wb = items[j]
            sim = len(wa & wb) / len(wa | wb)
            if sim >= thr:
                pairs.append({"a": _brief(a), "b": _brief(b), "similarity": round(sim, 3)})
    pairs.sort(key=lambda p: -p["similarity"])
    return _json({"pairs": pairs[:50]})


async def suggest_links(request: Request):
    lo = float(request.query_params.get("min", 0.30))
    hi = float(request.query_params.get("max", 0.55))
    linked = {(e["src"], e["dst"]) for e in memory.edges(mconn)}
    items = _token_sets(1500)
    pairs = []
    for i in range(len(items)):
        a, wa = items[i]
        for j in range(i + 1, len(items)):
            b, wb = items[j]
            if (a["id"], b["id"]) in linked or (b["id"], a["id"]) in linked:
                continue
            sim = len(wa & wb) / len(wa | wb)
            if lo <= sim < hi:
                pairs.append({"a": _brief(a), "b": _brief(b), "similarity": round(sim, 3)})
    pairs.sort(key=lambda p: -p["similarity"])
    return _json({"pairs": pairs[:30]})


async def stale(request: Request):
    days = int(request.query_params.get("days", 30))
    rows = mconn.execute(
        "SELECT id, type, title, updated, tags FROM memories WHERE status='active' "
        "AND updated < strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?) ORDER BY updated ASC LIMIT 50",
        (f"-{days} days",),
    ).fetchall()
    return _json({"days": days, "items": [dict(r) for r in rows]})


async def export_zip(request: Request):
    buf = io.BytesIO()
    files = sorted(cfg.memories.rglob("*.md"))
    stamp = datetime.now()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            if any(part.startswith(".") for part in p.relative_to(cfg.memories).parts):
                continue
            z.write(p, p.relative_to(cfg.root).as_posix())
        z.writestr(
            "README.txt",
            f"# BoltraMemory export\n\nCreated: {stamp.isoformat(timespec='seconds')}\nMemories: {len(files)}\n\n"
            "Restore: unzip into your AIMemory folder (memories/ goes back in place), then run `aim index`.\n",
        )
    name = f"boltramemory-export-{stamp.strftime('%Y%m%d-%H%M')}.zip"
    return Response(buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


# --------------------------------------------------------------------------- AI-backed routes

def _claude() -> str | None:
    return shutil.which("claude")


def _clean_env() -> dict:
    env = dict(os.environ)
    env.pop("CLAUDECODE", None)
    env.pop("CLAUDE_CODE_ENTRYPOINT", None)
    return env


async def summary(request: Request):
    mid = request.path_params["id"]
    cache = AIM / "summaries" / f"{mid}.txt"
    if request.method == "GET":
        s = cache.read_text(encoding="utf-8").strip() if cache.exists() else None
        return _json({"id": mid, "summary": s or None})
    m = memory.get(mconn, mid)
    if not m:
        return _json({"error": "not_found"}, 404)
    exe = _claude()
    if not exe:
        return _json({"error": "claude CLI not found on PATH"}, 503)
    prompt = ("Summarize the following memory in a single concise sentence (max 20 words). "
              f"Reply with ONLY the sentence, nothing else.\n\nTitle: {m['title']}\n\n{m['body']}")

    def run():
        return subprocess.run([exe, "-p", prompt], capture_output=True, text=True, encoding="utf-8",
                              timeout=60, env=_clean_env(), stdin=subprocess.DEVNULL)

    try:
        r = await asyncio.to_thread(run)
    except subprocess.TimeoutExpired:
        return _json({"error": "timeout"}, 504)
    lines = [l.strip() for l in (r.stdout or "").splitlines() if l.strip()]
    if not lines:
        return _json({"error": "empty response", "stderr": (r.stderr or "")[-500:]}, 502)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(lines[-1], encoding="utf-8")
    return _json({"id": mid, "summary": lines[-1]})


async def sync(request: Request):
    def run():
        return subprocess.run([sys.executable, str(cfg.root / "bin" / "aim"), "sync"], capture_output=True, text=True,
                              encoding="utf-8", timeout=60, cwd=cfg.root)

    try:
        r = await asyncio.to_thread(run)
    except subprocess.TimeoutExpired:
        return _json({"ok": False, "stdout": "", "stderr": "timeout"})
    return _json({"ok": r.returncode == 0, "stdout": (r.stdout or "")[-2000:], "stderr": (r.stderr or "")[-2000:]})


DISPATCH_PROMPT = """You are completing a task tracked in AIMemory.

Task id: {id}
Title: {title}

{body}

When done, call memory_write with type='conversation' to record what you did, then memory_link from your new memory to {id} with kind='produced_by'. Finally call task_complete with this task id."""


async def dispatch(request: Request):
    d = await _body(request)
    if not d or not d.get("id"):
        return _json({"error": "id required"}, 400)
    runner = d.get("runner", "claude")
    if runner not in ("claude", "codex"):
        return _json({"error": "runner must be claude or codex"}, 400)
    m = memory.get(mconn, d["id"])
    if not m:
        return _json({"error": "not_found"}, 404)
    exe = shutil.which(runner)
    if not exe:
        return _json({"error": f"{runner} not found on PATH"}, 400)
    tid = m["id"]
    _set_status_tag(m, "doing", runner=runner, add_agent=runner)
    prompt = DISPATCH_PROMPT.format(id=tid, title=m["title"], body=m["body"].strip())
    dangerous = d.get("dangerous", cfg.dispatch_skip_permissions)
    if runner == "claude":
        cmd = [exe, "-p", prompt] + (["--dangerously-skip-permissions"] if dangerous else [])
    else:
        cmd = [exe, "exec", prompt] + (["--full-auto"] if dangerous else [])
    log_path = AIM / f"dispatch-{tid}.log"
    log = open(log_path, "a", encoding="utf-8")
    log.write(f"--- dispatch {runner} @ {datetime.now(timezone.utc).isoformat(timespec='seconds')} ---\n")
    log.flush()
    env = _clean_env()
    env.update({"BOLTRAMEMORY_AGENT_NAME": f"{runner}-sub-{tid[:24]}", "BOLTRAMEMORY_PARENT": "dispatch",
                "BOLTRAMEMORY_TASK": tid})
    p = subprocess.Popen(cmd, cwd=cfg.root, stdin=subprocess.DEVNULL, stdout=log, stderr=log, env=env, **detached_kwargs())
    (AIM / f"dispatch-{tid}.pid").write_text(str(p.pid))
    return _json({"ok": True, "task_id": tid, "runner": runner, "pid": p.pid, "log": str(log_path)})


async def dispatch_stop(request: Request):
    tid = request.path_params["id"]
    pf = AIM / f"dispatch-{tid}.pid"
    if not pf.exists():
        return _json({"ok": True, "already_exited": True})
    try:
        pid = int(pf.read_text().strip())
    except ValueError:
        pf.unlink(missing_ok=True)
        return _json({"ok": True, "already_exited": True})
    if not pid_alive(pid):
        pf.unlink(missing_ok=True)
        return _json({"ok": True, "already_exited": True})
    terminate(pid)
    m = memory.get(mconn, tid)
    if m:
        _set_status_tag(m, "blocked", append="\n\n**Stopped by user.**\n")
    pf.unlink(missing_ok=True)
    return _json({"ok": True, "stopped": True, "pid": pid})


async def dispatch_log(request: Request):
    tid = request.path_params["id"]
    n = int(request.query_params.get("lines", 200))
    p = AIM / f"dispatch-{tid}.log"
    if not p.exists():
        return _json({"id": tid, "exists": False, "lines": [], "path": str(p), "bytes": 0})
    return _json({"id": tid, "exists": True, "lines": [l.rstrip("\n") for l in _tail_lines(p, n)],
                  "path": str(p), "bytes": p.stat().st_size, "running": _dispatch_running(tid)})


def _dispatch_running(tid: str) -> bool:
    pf = AIM / f"dispatch-{tid}.pid"
    try:
        return pf.exists() and pid_alive(int(pf.read_text().strip()))
    except ValueError:
        return False


ASK_PROMPT = (
    "Answer the question using only the memories below. Write the answer in the same language as the question, "
    "even when the memories are in another language: an English question gets an English answer, a Norwegian "
    "question a Norwegian one. Be concise: a few sentences, no preamble. Cite the memories you rely on as [id] "
    "right after the claim. If the memories don't answer it, say so plainly.\n\n# Question\n{q}\n\n# Memories\n{context}"
)
ASK_ARGS = ["-p", "--tools", "", "--strict-mcp-config", "--model", "sonnet", "--no-session-persistence",
            "--disable-slash-commands"]


async def ask(request: Request):
    d = await _body(request)
    q = (d or {}).get("q", "").strip()
    if not q:
        return _json({"error": "q required"}, 400)
    hits = memory.search(mconn, q, limit=10)
    context = "\n\n".join(f"### {h['title']} ({h['type']} · id: {h['id']})\n{h['body'][:1400]}" for h in hits) \
        or "(no memories matched the query keywords)"
    exe = _claude()
    if not exe:
        return _json({"error": "claude CLI not found on PATH"}, 503)
    prompt = ASK_PROMPT.format(q=q, context=context)

    def run():
        return subprocess.run([exe, *ASK_ARGS], input=prompt, capture_output=True, text=True, encoding="utf-8",
                              timeout=120, env=_clean_env(), cwd=AIM)

    try:
        r = await asyncio.to_thread(run)
    except subprocess.TimeoutExpired:
        return _json({"error": "timeout"}, 504)
    answer = (r.stdout or "").strip()
    hit_ids = {h["id"] for h in hits}
    cited = [c for c in dict.fromkeys(re.findall(r"\[([a-z0-9][a-z0-9-]*)\]", answer)) if c in hit_ids]
    if cited:
        _append_event({"type": "memory_accessed", "ts": time.time(), "op": "ask", "agent": "galaxy", "ids": cited,
                       "query": q[:160]})
    return _json({"answer": answer or (r.stderr or "").strip()[-500:], "cited": cited,
                  "context": [_brief(h) for h in hits]})


def _installed_clients() -> dict[str, bool]:
    home = Path.home()
    out = {"claude-code": False, "codex": False, "cursor": False}
    try:
        out["claude-code"] = "aimemory" in json.loads((home / ".claude.json").read_text(encoding="utf-8")).get("mcpServers", {})
    except Exception:
        pass
    try:
        out["codex"] = "[mcp_servers.aimemory]" in (home / ".codex" / "config.toml").read_text(encoding="utf-8")
    except Exception:
        pass
    try:
        out["cursor"] = "aimemory" in json.loads((home / ".cursor" / "mcp.json").read_text(encoding="utf-8")).get("mcpServers", {})
    except Exception:
        pass
    return out


async def presence(request: Request):
    now = time.time()
    last: dict[str, float] = {}
    for line in _tail_lines(cfg.events_path, 500):
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("type") == "memory_changed" and ev.get("id"):
            m = memory.get(mconn, ev["id"])
            for a in (m["agents"] if m else []):
                last[a] = max(last.get(a, 0), ev.get("ts", 0))
    installed = _installed_clients()
    names = list(dict.fromkeys(list(installed) + list(last)))
    agents = [{"name": n, "installed": installed.get(n, False), "live": now - last.get(n, 0) < 300,
               "last": last.get(n)} for n in names]
    return _json({"agents": agents, "now": now})


async def demo(request: Request):
    log = open(AIM / "demo.log", "a", encoding="utf-8")
    env = dict(os.environ, PYTHONPATH=str(cfg.root))
    p = subprocess.Popen([sys.executable, str(cfg.root / "scripts" / "demo.py")], cwd=cfg.root, env=env,
                         stdin=subprocess.DEVNULL, stdout=log, stderr=log, **detached_kwargs())
    return _json({"ok": True, "pid": p.pid})


async def benchmark(request: Request):
    d = await _body(request)
    if not d or not d.get("prompt"):
        return _json({"error": "prompt required"}, 400)
    runner = d.get("runner", "claude")
    exe = shutil.which(runner) if runner in ("claude", "codex") else None
    if not exe:
        return _json({"error": f"{runner} not found on PATH"}, 400)
    cmd = [exe, "-p", d["prompt"]] if runner == "claude" else [exe, "exec", d["prompt"]]
    t = time.time()

    def run():
        return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=180, env=_clean_env(),
                              cwd=AIM, stdin=subprocess.DEVNULL)

    try:
        r = await asyncio.to_thread(run)
    except subprocess.TimeoutExpired:
        return _json({"ok": False, "runner": runner, "error": "timeout"}, 504)
    elapsed = round(time.time() - t, 2)
    output = (r.stdout or "") or (r.stderr or "")
    saved = None
    if d.get("save", True):
        name = d.get("name") or d["prompt"][:40]
        mem = memory.write_memory(
            cfg, type="conversation", title=f"Benchmark · {name}",
            body=f"**Runner:** {runner} · {elapsed}s\n\n**Prompt**\n\n{d['prompt']}\n\n**Output**\n\n{output}",
            agents=[runner], tags=["benchmark", f"agent:{runner}"],
        )
        memory.upsert(mconn, mem)
        saved = mem.id
    return _json({"ok": r.returncode == 0, "runner": runner, "elapsed_s": elapsed, "output": output, "saved_id": saved})


async def events(request: Request):
    n = int(request.query_params.get("limit", 60))
    out = []
    for line in _tail_lines(cfg.events_path, n):
        try:
            out.append(json.loads(line))
        except ValueError:
            pass
    return _json({"events": out})


async def ws(websocket: WebSocket):
    await websocket.accept()
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    _subscribers.add(q)
    try:
        await websocket.send_text(json.dumps({"type": "hello"}))
        while True:
            ev = await q.get()
            await websocket.send_text(json.dumps(ev, ensure_ascii=False))
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        _subscribers.discard(q)


# --------------------------------------------------------------------------- static UI

NO_STORE = {"Cache-Control": "no-store"}


async def favicon(request: Request):
    for p in (DIST / "favicon.svg", cfg.root / "graph" / "public" / "favicon.svg"):
        if p.exists():
            return FileResponse(p, media_type="image/svg+xml")
    return Response(status_code=404)


async def galaxy_html(request: Request):
    p = DIST / "galaxy.html"
    if not p.exists():
        return PlainTextResponse("Galaxy not built. Run: pnpm --prefix graph exec vite build", 503)
    return FileResponse(p, headers=NO_STORE)


async def index_html(request: Request):
    p = DIST / "index.html"
    if not p.exists():
        return PlainTextResponse("BoltraMemory: UI not built yet. Run `pnpm --prefix graph run build`.", 503)
    return FileResponse(p, headers=NO_STORE)


# --------------------------------------------------------------------------- background tasks

async def _broadcast(ev: dict) -> None:
    for q in list(_subscribers):
        try:
            q.put_nowait(ev)
        except asyncio.QueueFull:
            _subscribers.discard(q)
    if ev.get("type") == "memory_changed" and cfg.webhook_on_memory_changed:
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                await c.post(cfg.webhook_on_memory_changed, json=ev)
        except Exception:
            pass


async def _tail_events() -> None:
    path = cfg.events_path
    pos = path.stat().st_size if path.exists() else 0
    buf = b""
    while True:
        await asyncio.sleep(0.5)
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if size < pos:
            pos, buf = 0, b""
        if size == pos:
            continue
        with open(path, "rb") as f:
            f.seek(pos)
            chunk = f.read()
            pos = f.tell()
        buf += chunk
        *lines, buf = buf.split(b"\n")
        for line in lines:
            if not line.strip():
                continue
            try:
                ev = json.loads(line.decode("utf-8", "ignore"))
            except ValueError:
                continue
            await _broadcast(ev)


def _scheduled_jobs() -> None:
    try:
        from server import cleanup

        reports = sorted((cfg.memories / "_reports").glob("cleanup-*.md"))
        if not reports or time.time() - reports[-1].stat().st_mtime > 7 * 86400:
            if cleanup.configured_repos(cfg):
                cleanup.scout(cfg.root)
    except Exception as e:
        print(f"[scheduler] cleanup scout failed: {e!r}", file=sys.stderr)
    try:
        from server import brief

        brief.maybe_generate(cfg)
    except Exception as e:
        print(f"[scheduler] brief failed: {e!r}", file=sys.stderr)


async def _scheduler() -> None:
    while True:
        try:
            await asyncio.to_thread(_scheduled_jobs)
        except Exception as e:
            print(f"[scheduler] {e!r}", file=sys.stderr)
        await asyncio.sleep(600)


@asynccontextmanager
async def lifespan(app):
    tasks = [asyncio.create_task(_tail_events()), asyncio.create_task(_scheduler())]
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()


# --------------------------------------------------------------------------- middleware

LOOPBACK = {"127.0.0.1", "::1", "localhost"}


def _headers(scope) -> dict[str, str]:
    return {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}


def _is_loopback(scope, headers: dict) -> bool:
    client = scope.get("client") or ("", 0)
    # A tunnel daemon also connects from loopback; its forwarding headers mark the request as remote.
    if "cf-connecting-ip" in headers or "x-forwarded-for" in headers:
        return False
    return client[0] in LOOPBACK


async def _send_json(send, status: int, data: dict, extra: list | None = None) -> None:
    body = json.dumps(data).encode()
    await send({"type": "http.response.start", "status": status,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())] + (extra or [])})
    await send({"type": "http.response.body", "body": body})


class CFAccessAllowlist:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket") or not cfg.allowed_emails:
            return await self.app(scope, receive, send)
        h = _headers(scope)
        if _is_loopback(scope, h) or (scope["type"] == "http" and scope["method"] == "GET" and scope["path"].startswith("/assets/")):
            return await self.app(scope, receive, send)
        email = h.get("cf-access-authenticated-user-email", "").lower()
        if email and email in cfg.allowed_emails:
            return await self.app(scope, receive, send)
        if scope["type"] == "websocket":
            return await send({"type": "websocket.close", "code": 1008})
        await _send_json(send, 403, {
            "error": "forbidden", "reason": "email not on allowlist", "saw_email": email or None,
            "allowlist": sorted(cfg.allowed_emails),
            "fix": "Add the email to [security].allowed_emails in config.toml, or put Cloudflare Access in front of the tunnel.",
        })


class RateLimit:
    PREFIXES = ("/ask", "/dispatch", "/summary", "/api/ask", "/api/dispatch", "/api/summary")

    def __init__(self, app):
        self.app = app
        self.hits: dict[str, deque] = {}

    async def __call__(self, scope, receive, send):
        limit = cfg.rate_limit_per_minute
        if scope["type"] != "http" or limit <= 0 or not scope["path"].startswith(self.PREFIXES):
            return await self.app(scope, receive, send)
        h = _headers(scope)
        if _is_loopback(scope, h):
            return await self.app(scope, receive, send)
        who = h.get("cf-access-authenticated-user-email") or (scope.get("client") or ("?",))[0]
        now = time.time()
        dq = self.hits.setdefault(who, deque())
        while dq and now - dq[0] > 60:
            dq.popleft()
        if len(dq) >= limit:
            retry = int(60 - (now - dq[0])) + 1
            return await _send_json(send, 429, {"error": "rate_limited", "retry_after": retry},
                                    [(b"retry-after", str(retry).encode())])
        dq.append(now)
        return await self.app(scope, receive, send)


# --------------------------------------------------------------------------- app

api_routes = [
    Route("/health", health),
    Route("/graph", graph),
    Route("/memory/{id}", memory_get, methods=["GET"]),
    Route("/memory", memory_post, methods=["POST"]),
    Route("/memory/{id}", memory_put, methods=["PUT"]),
    Route("/memory/{id}", memory_delete, methods=["DELETE"]),
    Route("/link", link, methods=["POST"]),
    Route("/search", search),
    Route("/projects", projects),
    Route("/code/search", code_search),
    Route("/duplicates", duplicates),
    Route("/suggest-links", suggest_links),
    Route("/stale", stale),
    Route("/export.zip", export_zip),
    Route("/summary/{id}", summary, methods=["GET", "POST"]),
    Route("/sync", sync, methods=["POST"]),
    Route("/dispatch", dispatch, methods=["POST"]),
    Route("/dispatch/{id}/stop", dispatch_stop, methods=["POST"]),
    Route("/dispatch-log/{id}", dispatch_log),
    Route("/ask", ask, methods=["POST"]),
    Route("/presence", presence),
    Route("/demo", demo, methods=["POST"]),
    Route("/benchmark", benchmark, methods=["POST"]),
    Route("/events", events),
    WebSocketRoute("/ws", ws),
]

routes = api_routes + [
    Mount("/api", routes=api_routes),
    Mount("/assets", app=StaticFiles(directory=DIST / "assets", check_dir=False)),
    Route("/favicon.svg", favicon),
    Route("/galaxy.html", galaxy_html),
    Route("/", index_html),
    Route("/{path:path}", index_html),
]

app = Starlette(
    routes=routes,
    lifespan=lifespan,
    middleware=[
        Middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]),
        Middleware(CFAccessAllowlist),
        Middleware(RateLimit),
    ],
)


def main() -> None:
    uvicorn.run(app, host=cfg.api_host, port=cfg.api_port, log_level="warning")


if __name__ == "__main__":
    main()
