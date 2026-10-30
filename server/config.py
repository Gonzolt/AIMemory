"""Load config.toml into a Config dataclass.

    python -m server.config     # print root and each project with exists=
"""
from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


@dataclass
class Project:
    name: str
    path: Path


@dataclass
class Config:
    root: Path
    memories: Path
    index: Path
    projects: list[Project] = field(default_factory=list)
    skip_dirs: set = field(default_factory=set)
    text_extensions: set = field(default_factory=set)
    chunk_lines: int = 60
    chunk_overlap: int = 10
    max_file_bytes: int = 524288
    api_host: str = "127.0.0.1"
    api_port: int = 5470
    ws_enabled: bool = True
    graph_dev_port: int = 5471
    sync_remote: str = ""
    sync_branch: str = "main"
    sync_auto_commit: bool = False
    allowed_emails: set = field(default_factory=set)
    rate_limit_per_minute: int = 0
    webhook_on_memory_changed: str = ""
    dispatch_skip_permissions: bool = True
    brief_repos: list[Path] = field(default_factory=list)

    @property
    def memory_db(self) -> Path:
        return self.index / "memory.sqlite"

    @property
    def code_db(self) -> Path:
        return self.index / "code.sqlite"

    @property
    def aim_dir(self) -> Path:
        return self.root / ".aim"

    @property
    def events_path(self) -> Path:
        return self.aim_dir / "events.jsonl"


def _p(s: str | Path) -> Path:
    return Path(str(s)).expanduser().resolve()


def load(path: str | Path | None = None) -> Config:
    path = Path(path) if path else ROOT / "config.toml"
    data: dict = {}
    if path.exists():
        with open(path, "rb") as f:
            data = tomllib.load(f)

    paths = data.get("paths", {})
    root = _p(paths.get("root", ROOT))
    if not root.exists():
        # config written on another machine/layout: fall back to the checkout itself
        root = ROOT
    memories = _p(paths.get("memories", root / "memories"))
    index = _p(paths.get("index", root / "index"))
    if not memories.parent.exists():
        memories = root / "memories"
    if not index.parent.exists():
        index = root / "index"

    idx = data.get("indexer", {})
    srv = data.get("server", {})
    sync = data.get("sync", {})
    sec = data.get("security", {})
    hooks = data.get("webhooks", {})
    disp = data.get("dispatch", {})
    brief = data.get("brief", {})

    cfg = Config(
        root=root,
        memories=memories,
        index=index,
        projects=[Project(p["name"], _p(p["path"])) for p in data.get("projects", []) if p.get("name") and p.get("path")],
        skip_dirs=set(idx.get("skip_dirs", [])),
        text_extensions={e.lower().lstrip(".") for e in idx.get("text_extensions", [])},
        chunk_lines=int(idx.get("chunk_lines", 60)),
        chunk_overlap=int(idx.get("chunk_overlap", 10)),
        max_file_bytes=int(idx.get("max_file_bytes", 524288)),
        api_host=srv.get("api_host", "127.0.0.1"),
        api_port=int(srv.get("api_port", 5470)),
        ws_enabled=bool(srv.get("ws_enabled", True)),
        graph_dev_port=int(data.get("graph", {}).get("dev_port", 5471)),
        sync_remote=sync.get("remote", "") or "",
        sync_branch=sync.get("branch", "main") or "main",
        sync_auto_commit=bool(sync.get("auto_commit", False)),
        allowed_emails={e.lower() for e in sec.get("allowed_emails", [])},
        rate_limit_per_minute=int(sec.get("rate_limit_per_minute", 0)),
        webhook_on_memory_changed=hooks.get("on_memory_changed", "") or "",
        dispatch_skip_permissions=bool(disp.get("dangerously_skip_permissions", True)),
        brief_repos=[_p(r) for r in brief.get("repos", [])],
    )
    cfg.memories.mkdir(parents=True, exist_ok=True)
    cfg.index.mkdir(parents=True, exist_ok=True)
    return cfg


if __name__ == "__main__":
    c = load()
    print(f"root: {c.root}")
    for p in c.projects:
        print(f"  {p.name}: {p.path} exists={p.path.exists()}")
