"""Disk scout/clean for git worktrees of the repos in [brief].repos.

scout(root)  — read-only. Writes .aim/cleanup/scout-<stamp>.json and memories/_reports/cleanup-<date>.md.
clean(root)  — acts on the latest report (<24 h). Dry run unless apply=True. Never `--force`.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

from server import config

CACHE_DIRS = (".next", ".turbo", ".swc", ".cache", "coverage", "playwright-report", "test-results", "out")
DISPOSABLE = re.compile(r"(^|[-_/])(wt|worktree|tmp|scratch|agent|claude|codex|try|spike|exp)([-_]|\d|$)", re.I)
GLOBAL_CACHES = ["~/.npm/_cacache", "~/Library/Caches/pnpm", "~/AppData/Local/pnpm-cache", "~/.cache/pip",
                 "~/AppData/Local/pip/cache", "~/Library/Caches/ms-playwright", "~/AppData/Local/ms-playwright",
                 "~/.bun/install/cache"]


def configured_repos(cfg) -> list[Path]:
    return [r for r in cfg.brief_repos if (r / ".git").exists()]


def _git(cwd: Path, *args: str, timeout: int = 30) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8", timeout=timeout)


def _size(path: Path) -> int:
    if shutil.which("du") and sys.platform != "win32":
        r = subprocess.run(["du", "-sk", str(path)], capture_output=True, text=True, timeout=300)
        try:
            return int(r.stdout.split()[0]) * 1024
        except (ValueError, IndexError):
            pass
    total = 0
    for root, dirs, files in os.walk(path, onerror=lambda e: None):
        for f in files:
            try:
                total += os.lstat(os.path.join(root, f)).st_size
            except OSError:
                pass
    return total


def _worktrees(repo: Path) -> list[dict]:
    r = _git(repo, "worktree", "list", "--porcelain")
    out, cur = [], {}
    for line in r.stdout.splitlines() + [""]:
        if not line:
            if cur:
                out.append(cur)
            cur = {}
            continue
        k, _, v = line.partition(" ")
        cur[k] = v or True
    return out


def _idle_days(wt: Path) -> float:
    stamps = []
    for p in (wt / ".git", ):
        if p.is_file():
            gitdir = p.read_text(encoding="utf-8").split(":", 1)[-1].strip()
            log = Path(gitdir) / "logs" / "HEAD"
            if log.exists():
                stamps.append(log.stat().st_mtime)
    trace = wt / ".next" / "trace"
    if trace.exists():
        stamps.append(trace.stat().st_mtime)
    r = _git(wt, "log", "-1", "--format=%ct")
    if r.stdout.strip().isdigit():
        stamps.append(int(r.stdout.strip()))
    return (time.time() - max(stamps)) / 86400 if stamps else 999.0


def _in_use(wt: Path) -> bool:
    if sys.platform == "win32" or not shutil.which("lsof"):
        return False
    r = subprocess.run(["lsof", "-a", "-d", "cwd", "+D", str(wt)], capture_output=True, text=True, timeout=30)
    return bool(r.stdout.strip())


def _env_lines(wt: Path, main: Path) -> int:
    main_lines = set()
    for f in main.glob(".env*"):
        if f.is_file():
            main_lines |= set(f.read_text(encoding="utf-8", errors="ignore").splitlines())
    unique = 0
    for f in wt.glob(".env*"):
        if f.is_file():
            unique += sum(1 for l in f.read_text(encoding="utf-8", errors="ignore").splitlines() if l.strip() and l not in main_lines)
    return unique


def _inspect(repo: Path, wt_info: dict, main: Path) -> dict:
    wt = Path(wt_info["worktree"])
    is_main = wt.resolve() == main.resolve()
    rec = {"repo": repo.name, "path": str(wt), "branch": str(wt_info.get("branch", "")).replace("refs/heads/", ""),
           "main": is_main, "locked": "locked" in wt_info, "prunable": "prunable" in wt_info}
    if not wt.exists():
        rec.update(action="prune", size=0)
        return rec
    status = _git(wt, "status", "--porcelain").stdout.splitlines()
    unpushed = _git(wt, "log", "--oneline", "@{u}..").stdout.strip() if _git(wt, "rev-parse", "@{u}").returncode == 0 \
        else _git(wt, "log", "--oneline", "HEAD", "--not", "--remotes").stdout.strip()
    ignored = [l[3:] for l in _git(wt, "status", "--porcelain", "--ignored").stdout.splitlines() if l.startswith("!!")]
    ignored_non_cache = [i for i in ignored if not any(i.rstrip("/").split("/")[0] == c for c in CACHE_DIRS + ("node_modules",))
                         and not i.startswith(".env")]
    caches = [c for c in CACHE_DIRS if (wt / c).exists()]
    rec.update(
        size=_size(wt), idle_days=round(_idle_days(wt), 1), in_use=_in_use(wt),
        modified=sum(1 for l in status if not l.startswith("??")), untracked=sum(1 for l in status if l.startswith("??")),
        unpushed=len(unpushed.splitlines()) if unpushed else 0, ignored_non_cache=ignored_non_cache[:20],
        env_unique_lines=_env_lines(wt, main), caches=caches,
        cache_bytes=sum(_size(wt / c) for c in caches),
    )
    clean = not rec["modified"] and not rec["untracked"] and not rec["unpushed"]
    if (not is_main and DISPOSABLE.search(wt.name) and rec["idle_days"] >= 3 and clean and not rec["in_use"]
            and not rec["locked"] and not ignored_non_cache):
        rec["action"] = "remove"
    elif caches and rec["idle_days"] >= 1 and not rec["in_use"]:
        rec["action"] = "slim"
    else:
        rec["action"] = "keep"
    return rec


def scout(root: Path | str | None = None) -> dict:
    cfg = config.load()
    root = Path(root or cfg.root)
    items = []
    for repo in configured_repos(cfg):
        wts = _worktrees(repo)
        main = Path(wts[0]["worktree"]) if wts else repo
        for w in wts:
            try:
                items.append(_inspect(repo, w, main))
            except Exception as e:  # one broken worktree must not sink the report
                items.append({"repo": repo.name, "path": w.get("worktree"), "action": "keep", "error": repr(e)})
    caches = []
    for c in GLOBAL_CACHES:
        p = Path(c).expanduser()
        if p.exists():
            caches.append({"path": str(p), "size": _size(p)})
    reclaim = sum(i.get("size", 0) for i in items if i["action"] == "remove") + \
        sum(i.get("cache_bytes", 0) for i in items if i["action"] == "slim")
    stamp = datetime.now()
    report = {"created": stamp.isoformat(timespec="seconds"), "worktrees": items, "global_caches": caches,
              "reclaimable_bytes": reclaim}
    out = root / ".aim" / "cleanup" / f"scout-{stamp.strftime('%Y-%m-%d-%H%M')}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=1), encoding="utf-8")
    md = root / "memories" / "_reports" / f"cleanup-{stamp.strftime('%Y-%m-%d')}.md"
    md.parent.mkdir(parents=True, exist_ok=True)
    md.write_text(summary(report) + "\n", encoding="utf-8")
    return report


def _gb(n: int) -> str:
    return f"{n / 1e9:.1f} GB"


def summary(report: dict) -> str:
    lines = [f"# Cleanup scout {report['created'][:10]}", "",
             f"Reclaimable: {_gb(report['reclaimable_bytes'])}", ""]
    if not report["worktrees"]:
        lines.append("No repos configured. Add `[brief] repos = [...]` to config.toml.")
    for w in report["worktrees"]:
        lines.append(f"- **{w['action']}** {w['path']} ({_gb(w.get('size', 0))}, idle {w.get('idle_days', '?')} d"
                     f"{', unpushed ' + str(w['unpushed']) if w.get('unpushed') else ''})")
    if report["global_caches"]:
        lines += ["", "Global caches:"] + [f"- {c['path']} ({_gb(c['size'])})" for c in report["global_caches"]]
    return "\n".join(lines)


def _archive_env(wt: Path) -> None:
    base = Path.home() / ("Library/Application Support" if sys.platform == "darwin" else ".local/share") / "boltramemory" / "env-archive" / wt.name
    for f in wt.glob(".env*"):
        if f.is_file():
            base.mkdir(parents=True, exist_ok=True)
            dst = base / f.name
            shutil.copy2(f, dst)
            try:
                os.chmod(dst, 0o600)
            except OSError:
                pass


def clean(root: Path | str | None = None, apply: bool = False, do_slim: bool = True, do_remove: bool = True) -> int:
    cfg = config.load()
    root = Path(root or cfg.root)
    scouts = sorted((root / ".aim" / "cleanup").glob("scout-*.json"))
    if not scouts or time.time() - scouts[-1].stat().st_mtime > 86400:
        print("No scout report from the last 24 h. Run `aim scout` first.")
        return 1
    report = json.loads(scouts[-1].read_text(encoding="utf-8"))
    repos = {r.name: r for r in configured_repos(cfg)}
    for w in report["worktrees"]:
        repo = repos.get(w["repo"])
        if not repo:
            continue
        wt = Path(w["path"])
        if w["action"] == "slim" and do_slim:
            fresh = _inspect(repo, {"worktree": str(wt)}, repo)
            if fresh.get("in_use"):
                print(f"skip slim (in use): {wt}")
                continue
            for c in fresh.get("caches", []):
                print(f"{'rm' if apply else 'would rm'} {wt / c}")
                if apply:
                    shutil.rmtree(wt / c, ignore_errors=True)
        elif w["action"] == "remove" and do_remove:
            fresh = _inspect(repo, {"worktree": str(wt)}, Path(_worktrees(repo)[0]["worktree"]))
            if fresh["action"] != "remove":
                print(f"skip remove (changed since scout → {fresh['action']}): {wt}")
                continue
            print(f"{'remove' if apply else 'would remove'} worktree {wt}")
            if apply:
                _archive_env(wt)
                r = _git(repo, "worktree", "remove", str(wt))
                if r.returncode:
                    print("  git refused:", r.stderr.strip())
    if apply:
        for repo in repos.values():
            _git(repo, "worktree", "prune")
    else:
        print("\nDry run. Re-run with --yes to apply.")
    return 0
