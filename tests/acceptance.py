"""Acceptance tests from the rebuild spec (§13), run against a throwaway copy.

    python tests/acceptance.py

Copies server/, bin/, scripts/ into a temp root with its own config.toml (API on
port 5480), so the real hub is never touched. UI checks (20) are manual.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="aim-accept-"))
ROOT = TMP / "AIMemory"
PROJ = TMP / "proj"
PORT = 5480
results: list[tuple[str, bool, str]] = []

EXPECTED_TOOLS = sorted("""agent_done agent_list agent_register audit_query code_projects code_read code_search
graph_hubs graph_neighbors graph_overview graph_path memory_context memory_link memory_list
memory_read memory_recent memory_search memory_system_context memory_write task_block
task_claim task_complete task_create task_handoff task_list template_apply template_list""".split())


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{('  — ' + detail) if detail and not ok else ''}", flush=True)


def setup() -> None:
    ROOT.mkdir(parents=True)
    for d in ("server", "bin", "scripts"):
        shutil.copytree(REPO / d, ROOT / d, ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copy(REPO / ".aimemoryignore", ROOT / ".aimemoryignore")
    cfg = (REPO / "config.toml").read_text(encoding="utf-8")
    cfg = cfg.replace('root = "~/Documents/AIMemory"', f'root = {json.dumps(ROOT.as_posix())}')
    cfg = cfg.replace('memories = "~/Documents/AIMemory/memories"', f'memories = {json.dumps((ROOT / "memories").as_posix())}')
    cfg = cfg.replace('index = "~/Documents/AIMemory/index"', f'index = {json.dumps((ROOT / "index").as_posix())}')
    cfg = cfg.replace('path = "~/Documents/AIMemory/server"', f'path = {json.dumps(PROJ.as_posix())}')
    cfg = cfg.replace("api_port = 5470", f"api_port = {PORT}")
    (ROOT / "config.toml").write_text(cfg, encoding="utf-8")
    # code project fixtures
    (PROJ / "src").mkdir(parents=True)
    (PROJ / "src" / "big.ts").write_text("\n".join(f"const line{i} = {i}; // marker zebracornfish" if i == 55 else f"const line{i} = {i};"
                                                   for i in range(1, 131)), encoding="utf-8")
    (PROJ / "node_modules" / "x").mkdir(parents=True)
    (PROJ / "node_modules" / "x" / "index.ts").write_text("export const hidden = 'nodemoduleszebra';", encoding="utf-8")
    (PROJ / "lib.min.js").write_text("var minifiedzebra=1;", encoding="utf-8")
    (PROJ / "huge.ts").write_text("// hugezebra\n" + "x" * 600_000, encoding="utf-8")
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=ROOT, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=ROOT)
    subprocess.run(["git", "config", "user.name", "test"], cwd=ROOT)


def env() -> dict:
    e = dict(os.environ, PYTHONPATH=str(ROOT), PYTHONIOENCODING="utf-8")
    e.pop("BOLTRAMEMORY_AGENT_NAME", None)
    return e


def aim(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(ROOT / "bin" / "aim"), *args], cwd=ROOT, env=env(),
                          capture_output=True, text=True, encoding="utf-8")


def unwrap(res):
    sc = res.structuredContent
    if isinstance(sc, dict) and set(sc) == {"result"}:
        return sc["result"]
    if sc is not None:
        return sc
    text = "".join(getattr(c, "text", "") for c in res.content)
    try:
        return json.loads(text)
    except ValueError:
        return text


async def mcp_tests() -> None:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    params = StdioServerParameters(command=sys.executable, args=["-m", "server.mcp_server"], env=env(), cwd=str(ROOT))
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()

            async def call(_tool, **kw):
                return unwrap(await s.call_tool(_tool, kw))

            tools = await s.list_tools()
            names = sorted(t.name for t in tools.tools)
            check("1 tool parity (27 names)", names == EXPECTED_TOOLS, str(set(names) ^ set(EXPECTED_TOOLS)))
            mw = next(t for t in tools.tools if t.name == "memory_write").inputSchema["properties"]
            check("1 memory_write params/defaults", list(mw) == ["type", "title", "body", "id", "agents", "projects", "tags",
                                                                 "confidence", "status", "expected_updated"]
                  and mw["confidence"]["default"] == "medium", str(list(mw)))

            # 2 slug
            r1 = await call("memory_write", type="decision", title="K-Lab landing: Decision!", body="x",
                            projects=["klab"], tags=["true", "2026", "-x"])
            p = ROOT / "memories" / "decision" / "k-lab-landing-decision.md"
            check("2 slug", r1["id"] == "k-lab-landing-decision" and p.exists(), json.dumps(r1))
            r2 = await call("memory_write", type="decision", title="Explicit id", body="y", id="My_ID")
            check("2 explicit id verbatim", (ROOT / "memories" / "decision" / "My_ID.md").exists(), json.dumps(r2))

            # 3 format
            text = p.read_text(encoding="utf-8")
            front = text.split("---\n")[1]
            keys = [l.split(":")[0] for l in front.splitlines() if l and not l.startswith(" ")]
            check("3 key order", keys == ["id", "type", "title", "created", "updated", "agents", "projects", "tags",
                                         "status", "confidence", "links", "hubs"], str(keys))
            check("3 quoting", 'title: "K-Lab landing: Decision!"' in text and '  - "true"' in text and '  - "2026"' in text
                  and '  - "-x"' in text and "agents: []" in text and "links: []" in text, text)
            check("3 project hub", (ROOT / "memories" / "_projects" / "klab.md").exists())

            # 4 round-trip
            sys.path.insert(0, str(ROOT))
            from server import memory as M  # noqa: E402

            m = M.load_file(p)
            check("4 round-trip", m.id == "k-lab-landing-decision" and m.title == "K-Lab landing: Decision!" and m.body == "x\n"
                  and m.tags == ["true", "2026", "-x"] and m.projects == ["klab"] and m.links == [], repr(m))
            (ROOT / "memories" / "reference" ).mkdir(parents=True, exist_ok=True)
            (ROOT / "memories" / "reference" / "no-id.md").write_text("---\ntitle: no id\n---\nbody\n", encoding="utf-8")

            # 5 created preserved
            created = m.created
            time.sleep(1.1)
            await call("memory_write", type="decision", title="K-Lab landing: Decision!", body="x2")
            m2 = M.load_file(p)
            check("5 created preserved", m2.created == created and m2.updated > m.updated, f"{m2.created} {m2.updated}")

            # 6 conflict
            u = (await call("memory_read", id="k-lab-landing-decision"))["updated"]
            time.sleep(1.1)
            await call("memory_write", type="decision", title="K-Lab landing: Decision!", body="x3", id="k-lab-landing-decision")
            before = p.read_text(encoding="utf-8")
            c = await call("memory_write", type="decision", title="K-Lab landing: Decision!", body="mine",
                           id="k-lab-landing-decision", expected_updated=u)
            check("6 conflict", c.get("status") == "conflict" and c["their_updated"] > u and p.read_text(encoding="utf-8") == before,
                  json.dumps(c)[:300])

            # 7 suggested links
            base = "Postgres connection pooling with pgbouncer keeps database connections bounded under heavy agent load"
            await call("memory_write", type="decision", title="Postgres pooling decision", body=base)
            r7 = await call("memory_write", type="reference", title="Pooling notes",
                            body=base + " and transaction mode pooling works best")
            check("7 suggested_links", any(x["id"] == "postgres-pooling-decision" for x in r7["suggested_links"]), json.dumps(r7))

            # 8 search
            await call("memory_write", type="reference", title="Unrelated note", body="we talk about pooling once here")
            hits = await call("memory_search", query="pooling postgres")
            ids = [h["id"] for h in hits]
            check("8 AND/OR fallback", "postgres-pooling-decision" in ids, str(ids))
            hits = await call("memory_search", query="pooling")
            ids = [h["id"] for h in hits]
            check("8 title outranks body", ids.index("postgres-pooling-decision") < ids.index("unrelated-note"), str(ids))
            rec = await call("memory_search", query="")
            check("8 empty query = recent", len(rec) > 0 and rec[0]["id"] == "unrelated-note", str([h["id"] for h in rec][:3]))

            # 9 context budget
            await call("memory_write", type="reference", title="Longform zebra", body="zebra " * 80)
            ctx = await call("memory_context", query="zebra", max_tokens=10)
            check("9 oversized first hit alone", ctx["included_ids"] == ["longform-zebra"]
                  and ctx["used_tokens"] == len(ctx["markdown"]) // 4, json.dumps(ctx)[:200])
            none = await call("memory_context", query="qqqnomatchqqq")
            check("9 no matches", none["markdown"] == "(no matches)" and none["included_ids"] == [])

            # 10 pinned
            await call("memory_write", type="feedback", title="Rule one", body="r1", tags=["pinned:true"])
            await call("memory_write", type="feedback", title="Rule two", body="r2", tags=["pinned:true"])
            sc = await call("memory_system_context")
            check("10 pinned", sc["count"] == 2 and sc["markdown"].startswith("# System context — pinned memories"), json.dumps(sc)[:200])

            # 11 links
            await call("memory_write", type="decision", title="Alpha", body="a")
            await call("memory_write", type="decision", title="Beta", body="b")
            await call("memory_write", type="decision", title="Gamma", body="c")
            l = await call("memory_link", src="alpha", dst="beta", kind="supersedes")
            at = (ROOT / "memories" / "decision" / "alpha.md").read_text(encoding="utf-8")
            check("11 link persisted", l["ok"] and "  - to: beta\n    kind: supersedes" in at and 'related:\n  - "[[beta]]"' in at, at)
            miss = await call("memory_link", src="alpha", dst="missing")
            check("11 missing → ok:false", miss["ok"] is False)
            bad = await s.call_tool("memory_link", {"src": "alpha", "dst": "beta", "kind": "foo"})
            check("11 bad kind errors", bad.isError)

            # 12 graph (alpha->beta exists; add beta->gamma; remove supersedes noise not needed)
            await call("memory_link", src="beta", dst="gamma", kind="mentions")
            gp = await call("graph_path", from_id="alpha", to_id="gamma")
            check("12 path", gp.get("path") == ["alpha", "beta", "gamma"] and gp.get("hops") == 2, json.dumps(gp))
            gn = await call("graph_neighbors", id="gamma", depth=2)
            check("12 neighbors depth 2", "alpha" in [n["id"] for n in gn["nodes"]], json.dumps(gn)[:300])
            hub = await call("graph_hubs", top=1)
            check("12 hubs", hub and hub[0]["id"] == "beta" and hub[0]["degree"] == 2, json.dumps(hub))
            check("12 path to self", await call("graph_path", from_id="alpha", to_id="alpha") == {"path": ["alpha"], "edges": []})

            # 13 tasks
            t = await call("task_create", title="Ship X", assigned_to="codex", depends_on=["alpha"])
            tm = await call("memory_read", id=t["id"])
            edges = (await call("graph_neighbors", id=t["id"]))["edges"]
            check("13 create", "status:todo" in tm["tags"] and "agent:codex" in tm["tags"]
                  and any(e["dst"] == "alpha" and e["kind"] == "derived_from" for e in edges), json.dumps(tm["tags"]))
            await call("task_claim", id=t["id"], agent="claude")
            tm = await call("memory_read", id=t["id"])
            check("13 claim", "status:doing" in tm["tags"] and "agent:claude" in tm["tags"] and "agent:codex" not in tm["tags"])
            await call("task_handoff", task_id=t["id"], to_agent="codex", message="pls")
            tm = await call("memory_read", id=t["id"])
            check("13 handoff", "status:todo" in tm["tags"] and "agent:codex" in tm["tags"] and "**Handoff** → `codex`" in tm["body"])
            await call("task_block", id=t["id"], reason="r")
            check("13 block", "status:blocked" in (await call("memory_read", id=t["id"]))["tags"])
            await call("task_complete", id=t["id"], result_summary="ok")
            tm = await call("memory_read", id=t["id"])
            check("13 complete", "status:done" in tm["tags"] and tm["body"].rstrip().endswith("**Completed:** ok"))
            check("13 list done", t["id"] in [x["id"] for x in await call("task_list", status="done")])

            # 14 agents
            await call("agent_register", name="x", parent="dispatch")
            check("14 agent_list", "x" in [a["name"] for a in await call("agent_list")])
            d = await call("agent_done", name="x", summary="s")
            check("14 agent_done", d["had_session"] and (ROOT / "memories" / "conversation" / "x-session-summary.md").exists())

            # 15 templates
            check("15 template ids", [x["id"] for x in await call("template_list")] == ["adr", "postmortem", "task", "research", "session-summary"])
            ta = await call("template_apply", template_id="adr", title="Use SQLite", fields={"Decision": "SQLite"})
            tam = await call("memory_read", id=ta["id"])
            check("15 template_apply", ta["type"] == "decision" and "adr" in tam["tags"] and "**Decision**\nSQLite" in tam["body"])

            # 16a activity
            await call("memory_search", query="pooling")
            evs = [json.loads(l) for l in (ROOT / ".aim" / "events.jsonl").read_text(encoding="utf-8").splitlines()]
            check("16 search logs memory_accessed", any(e["type"] == "memory_accessed" and e["op"] == "search" for e in evs))

            # 17 code
            r = aim("index")
            cs = await call("code_search", query="zebracornfish")
            check("17 code_search", bool(cs) and all(h["path"].endswith("big.ts") and h["line_start"] <= 55 <= h["line_end"] for h in cs),
                  json.dumps(cs)[:300])
            from server import code_index as C  # noqa: E402

            ch = [(a, b) for a, b, _ in C.chunk((PROJ / "src" / "big.ts").read_text(encoding="utf-8"))]
            check("17 chunks", ch == [(1, 60), (51, 110), (101, 130)], str(ch))
            for q in ("nodemoduleszebra", "minifiedzebra", "hugezebra"):
                check(f"17 skipped ({q})", await call("code_search", query=q) == [])
            cr = await call("code_read", path=str(PROJ / "src" / "big.ts"), line_start=51, line_end=60)
            check("17 code_read range", cr.splitlines()[0] == "const line51 = 51;" and len(cr.splitlines()) == 10, cr[:80])
            cp = await call("code_projects")
            check("17 code_projects", [x["project"] for x in cp] == ["aimemory"] and cp[0]["files"] == 1, json.dumps(cp))


def watcher_and_api_tests() -> None:
    log = open(TMP / "procs.log", "a")
    w = subprocess.Popen([sys.executable, "-m", "server.watcher"], cwd=ROOT, env=env(), stdout=log, stderr=log)
    a = subprocess.Popen([sys.executable, "-m", "server.api"], cwd=ROOT, env=env(), stdout=log, stderr=log)
    try:
        base = f"http://127.0.0.1:{PORT}"
        for _ in range(60):
            try:
                urllib.request.urlopen(base + "/health", timeout=1)
                break
            except Exception:
                time.sleep(0.25)
        time.sleep(1.0)

        def get(path):
            with urllib.request.urlopen(base + path, timeout=5) as r:
                return json.loads(r.read())

        def req(method, path, data=None, headers=None):
            rq = urllib.request.Request(base + path, method=method, data=json.dumps(data).encode() if data is not None else None,
                                        headers={"content-type": "application/json", **(headers or {})})
            try:
                with urllib.request.urlopen(rq, timeout=10) as r:
                    return r.status, json.loads(r.read())
            except urllib.error.HTTPError as e:
                return e.code, json.loads(e.read() or b"{}")

        check("19 /health and /api/health", get("/health") == {"ok": True} and get("/api/health") == {"ok": True})
        g = get("/api/graph")
        check("19 /api/graph", set(g) == {"nodes", "edges"} and len(g["nodes"]) > 5)

        # WS + watcher (16b): hand edit → memory_changed within ~1s
        import websockets.sync.client as wsc

        with wsc.connect(f"ws://127.0.0.1:{PORT}/ws", open_timeout=5) as ws:
            hello = json.loads(ws.recv(timeout=5))
            p = ROOT / "memories" / "decision" / "gamma.md"
            p.write_text(p.read_text(encoding="utf-8").replace("\nc\n", "\nc edited by hand\n"), encoding="utf-8")
            t0 = time.time()
            got = None
            while time.time() - t0 < 5:
                ev = json.loads(ws.recv(timeout=5))
                if ev.get("type") == "memory_changed" and ev.get("id") == "gamma":
                    got = time.time() - t0
                    break
            check("19 ws hello + memory_changed", hello == {"type": "hello"} and got is not None and got < 2.0, f"{got}")

        from mcp_audit import audit  # noqa: E402  (helper below)

        aud = audit(5, "memory_changed")
        check("16 audit_query newest first", aud and aud[0].get("id") == "gamma", json.dumps(aud[:2]))
        st, row = req("GET", "/api/memory/gamma")
        check("16 hand edit reindexed", "edited by hand" in row.get("body", ""))

        st, r = req("POST", "/api/memory", {"type": "reference", "title": "From the API", "body": "hello"})
        check("19 POST /memory", st == 200 and r["id"] == "from-the-api" and r["path"])
        st, r = req("PUT", "/api/memory/from-the-api", {"tags": ["pinned:true"]})
        st2, row = req("GET", "/api/memory/from-the-api")
        check("19 PUT /memory partial", st == 200 and row["tags"] == ["pinned:true"] and row["body"].strip() == "hello"
              and row["agents"] == ["ui"], json.dumps(row)[:200])
        st, r = req("POST", "/api/link", {"src": "from-the-api", "dst": "alpha"})
        check("19 POST /link", st == 200 and r["kind"] == "mentions")
        st, r = req("POST", "/api/link", {"src": "from-the-api", "dst": "nope"})
        check("19 POST /link 404", st == 404)
        st, r = req("POST", "/api/link", {"src": "from-the-api", "dst": "alpha", "kind": "foo"})
        check("19 POST /link bad kind 400", st == 400)
        st, r = req("DELETE", "/api/memory/from-the-api")
        check("19 DELETE /memory", st == 200 and not (ROOT / "memories" / "reference" / "from-the-api.md").exists())
        check("19 search/projects/code", get("/api/search?q=pooling")["results"] and get("/api/projects")["projects"]
              and get("/api/code/search?q=zebracornfish")["results"])
        check("19 duplicates/suggest/stale", "pairs" in get("/api/duplicates") and "pairs" in get("/api/suggest-links")
              and get("/api/stale?days=30")["days"] == 30)
        with urllib.request.urlopen(base + "/api/export.zip", timeout=10) as r:
            check("19 export.zip", r.headers["content-type"] == "application/zip"
                  and "boltramemory-export-" in r.headers["content-disposition"])
        check("19 events", len(get("/api/events?limit=5")["events"]) == 5)
    finally:
        for p in (w, a):
            p.terminate()
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()


def allowlist_test() -> None:
    """Non-loopback without an allowed CF email → 403 when the allowlist is set."""
    sys.path.insert(0, str(ROOT))
    os.chdir(ROOT)
    from starlette.testclient import TestClient

    import server.api as api

    api.cfg.allowed_emails = {"owner@example.com"}
    c = TestClient(api.app, client=("203.0.113.5", 1234))
    r = c.get("/api/health")
    ok = c.get("/api/health", headers={"cf-access-authenticated-user-email": "owner@example.com"})
    loop = TestClient(api.app, client=("127.0.0.1", 1234)).get("/api/health")
    check("19 allowlist 403 / allowed / loopback", r.status_code == 403 and ok.status_code == 200 and loop.status_code == 200,
          f"{r.status_code} {ok.status_code} {loop.status_code}")
    api.cfg.allowed_emails = set()


def cli_tests() -> None:
    st = aim("status").stdout
    mem_line = next(l for l in st.splitlines() if l.startswith("Memories:"))
    for f in (ROOT / "index").glob("*.sqlite*"):
        try:
            f.unlink()
        except OSError:
            pass
    aim("index")
    st2 = aim("status").stdout
    check("18 rebuildable", mem_line in st2, f"{mem_line!r} vs {st2.splitlines()[1]!r}")
    check("4 file without id not indexed", "no-id" not in aim("search", "no id").stdout)
    r = aim("sync", "-m", "test")
    check("22 sync commits locally", "committed locally" in r.stdout, r.stdout + r.stderr)
    r2 = aim("sync", "-m", "test")
    check("22 sync no-op when clean", "nothing to commit" in r2.stdout, r2.stdout)
    r = aim("snapshot")
    tags = subprocess.run(["git", "tag"], cwd=ROOT, capture_output=True, text=True).stdout
    check("22 snapshot tag", tags.startswith("snapshot-") and len(tags.strip()) == len("snapshot-YYYY-MM-DD-HHMM"), tags + r.stderr)
    w = aim("write", "decision", "Written from CLI", "--body", "cli body", "--projects", "a,b", "--tags", "x")
    check("CLI write", w.stdout.startswith("✓ wrote written-from-cli"), w.stdout + w.stderr)


def brief_test() -> None:
    code = (
        "import sys; sys.path.insert(0, r'%s')\n"
        "from server import brief, config\n"
        "brief._call_model = lambda p, c: (None, 'test run')\n"
        "print(brief.generate(config.load()))\n" % ROOT
    )
    r = subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=env(), capture_output=True, text=True, encoding="utf-8")
    today = time.strftime("%Y-%m-%d")
    p = ROOT / "memories" / "_briefs" / f"{today}.md"
    t = p.read_text(encoding="utf-8") if p.exists() else ""
    check("23 brief files", p.exists() and (ROOT / "memories" / "Brief.md").exists(), r.stderr[-400:])
    check("23 brief shape", t.startswith(f"# Brief {today}") and t.count("\n## ") == 4 and "<!-- aim-brief generated=" in t, t[:300])
    aim("index")
    import sqlite3

    n = sqlite3.connect(ROOT / "index" / "memory.sqlite").execute(
        "SELECT COUNT(*) FROM memories WHERE path LIKE '%_briefs%' OR path LIKE '%Brief.md'").fetchone()[0]
    check("23 brief not indexed", n == 0, str(n))


def clients_test() -> None:
    home = TMP / "home"
    (home / ".codex").mkdir(parents=True)
    (home / ".cursor").mkdir(parents=True)
    (home / ".claude.json").write_text(json.dumps({"mcpServers": {"other": {"command": "x"}}}), encoding="utf-8")
    (home / ".codex" / "config.toml").write_text(
        'model = "o3"\n\n[mcp_servers.aimemory]\ncommand = "old"\n\n[mcp_servers.aimemory.env]\nPYTHONPATH = "old"\n\n'
        '[mcp_servers.aimemory.tools.memory_system_context]\napproval_mode = "approve"\n', encoding="utf-8")
    e = dict(env(), HOME=str(home), USERPROFILE=str(home))
    for _ in range(2):
        subprocess.run([sys.executable, str(ROOT / "scripts" / "install_clients.py")], env=e, capture_output=True)
    cj = json.loads((home / ".claude.json").read_text(encoding="utf-8"))
    codex = (home / ".codex" / "config.toml").read_text(encoding="utf-8")
    cur = json.loads((home / ".cursor" / "mcp.json").read_text(encoding="utf-8"))
    import tomllib

    try:
        parsed = tomllib.loads(codex)
        valid = True
    except Exception:
        parsed, valid = {}, False
    check("21 install-clients idempotent", set(cj["mcpServers"]) == {"other", "aimemory"} and codex.count("[mcp_servers.aimemory]") == 1
          and valid and parsed["mcp_servers"]["aimemory"]["tools"]["memory_system_context"]["approval_mode"] == "approve"
          and "aimemory" in cur["mcpServers"] and (home / ".claude.json.bak").exists(), codex)


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    setup()
    r = aim("init")
    check("init", r.returncode == 0 and "Memory index built" in r.stdout, r.stdout + r.stderr)
    asyncio.run(mcp_tests())
    # tiny helper module so the watcher test can call audit_query in-process against the temp root
    (TMP / "mcp_audit.py").write_text(
        "import sys, importlib\nsys.path.insert(0, r'%s')\n"
        "def audit(mins, et):\n    import server.mcp_server as s\n    return s.audit_query(since_minutes=mins, event_type=et)\n" % ROOT,
        encoding="utf-8")
    sys.path.insert(0, str(TMP))
    os.chdir(ROOT)
    watcher_and_api_tests()
    allowlist_test()
    cli_tests()
    brief_test()
    clients_test()
    failed = [n for n, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed" + (f"; failed: {failed}" if failed else ""))
    print(f"temp root: {TMP}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
