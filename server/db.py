"""SQLite helpers. Both databases get the full schema; only the relevant tables fill."""
from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA = Path(__file__).with_name("schema.sql")


def connect(path: str | Path) -> sqlite3.Connection:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_schema(memory_db: str | Path, code_db: str | Path) -> None:
    ddl = SCHEMA.read_text(encoding="utf-8")
    for p in (memory_db, code_db):
        conn = connect(p)
        try:
            conn.executescript(ddl)
        finally:
            conn.close()
