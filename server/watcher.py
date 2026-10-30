"""File watcher: keeps the SQLite indexes in sync with disk and feeds .aim/events.jsonl.

    python -m server.watcher

The events file is the only cross-process IPC; the API tails it.
"""
from __future__ import annotations

import json
import signal
import sys
import threading
import time
from pathlib import Path

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from server import code_index, config, db, memory

cfg = config.load()
_lock = threading.Lock()


def _log(msg: str) -> None:
    print(f"[watch] {msg}", file=sys.stderr, flush=True)


def _emit(ev: dict) -> None:
    ev = {"type": ev.pop("type"), "ts": time.time(), **ev}
    with _lock:
        cfg.events_path.parent.mkdir(parents=True, exist_ok=True)
        with open(cfg.events_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(ev, ensure_ascii=False) + "\n")


class MemoryHandler(FileSystemEventHandler):
    def __init__(self, conn):
        self.conn = conn

    def _relevant(self, path: str) -> bool:
        p = Path(path)
        if p.suffix.lower() != ".md":
            return False
        try:
            rel = p.resolve().relative_to(cfg.memories)
        except ValueError:
            return False
        return not any(part.startswith(".") for part in rel.parts)

    def _changed(self, path: str) -> None:
        if not self._relevant(path):
            return
        p = Path(path)
        if not p.exists():
            self._deleted(path)
            return
        mem = memory.load_file(p)
        if not mem:
            return
        with _lock:
            memory.upsert(self.conn, mem)
        _log(f"memory {mem.id}")
        _emit({"type": "memory_changed", "id": mem.id})

    def _deleted(self, path: str) -> None:
        if not self._relevant(path):
            return
        with _lock:
            mid = memory.delete_by_path(self.conn, path)
        if mid:
            _log(f"deleted {mid}")
            _emit({"type": "memory_deleted", "id": mid})

    def on_created(self, event):
        if not event.is_directory:
            self._changed(event.src_path)

    def on_modified(self, event):
        if not event.is_directory:
            self._changed(event.src_path)

    def on_deleted(self, event):
        if not event.is_directory:
            self._deleted(event.src_path)

    def on_moved(self, event):
        if not event.is_directory:
            self._deleted(event.src_path)
            self._changed(event.dest_path)


class CodeHandler(FileSystemEventHandler):
    def __init__(self, conn, proj):
        self.conn = conn
        self.proj = proj
        self.globs = code_index.load_ignore_globs(cfg.root)

    def _skipped(self, path: str) -> bool:
        try:
            rel = Path(path).resolve().relative_to(self.proj.path)
        except ValueError:
            return True
        return code_index._is_skipped(rel, cfg.skip_dirs, self.globs)

    def _handle(self, path: str) -> None:
        if self._skipped(path):
            return
        p = Path(path)
        abs_path = str(p.resolve())
        if not p.exists():
            with _lock:
                row = self.conn.execute("SELECT 1 FROM code_files WHERE path=?", (abs_path,)).fetchone()
                if row:
                    code_index._delete_file(self.conn, abs_path)
            if row:
                _emit({"type": "code_deleted", "path": abs_path, "project": self.proj.name})
            return
        if p.suffix.lower().lstrip(".") not in cfg.text_extensions:
            return
        with _lock:
            code_index.index_project(self.conn, cfg, self.proj)
        _emit({"type": "code_changed", "path": abs_path, "project": self.proj.name})

    def on_created(self, event):
        if not event.is_directory:
            self._handle(event.src_path)

    def on_modified(self, event):
        if not event.is_directory:
            self._handle(event.src_path)

    def on_deleted(self, event):
        if not event.is_directory:
            self._handle(event.src_path)


def main() -> None:
    db.init_schema(cfg.memory_db, cfg.code_db)
    mconn = db.connect(cfg.memory_db)
    cconn = db.connect(cfg.code_db)
    n = memory.reindex_all(cfg, mconn)
    obs = Observer()
    obs.schedule(MemoryHandler(mconn), str(cfg.memories), recursive=True)
    _log(f"memories: {cfg.memories} ({n} indexed)")
    for proj in cfg.projects:
        if proj.path.exists():
            obs.schedule(CodeHandler(cconn, proj), str(proj.path), recursive=True)
            _log(f"code: {proj.name} → {proj.path}")
        else:
            _log(f"code: {proj.name} missing ({proj.path})")
    obs.start()

    stop = threading.Event()

    def _bye(*_):
        stop.set()

    signal.signal(signal.SIGINT, _bye)
    signal.signal(signal.SIGTERM, _bye)
    try:
        while not stop.is_set():
            stop.wait(0.5)
    finally:
        obs.stop()
        obs.join(timeout=5)
        _log("stopped")


if __name__ == "__main__":
    main()
