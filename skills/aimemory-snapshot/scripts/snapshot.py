"""Read-only snapshot of the AIMemory index as JSON."""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(os.environ.get("AIMEMORY_ROOT", "~/Documents/AIMemory")).expanduser()
DB = ROOT / "index" / "memory.sqlite"


def main() -> int:
    if not DB.exists():
        print(json.dumps({"error": f"index not found at {DB}; run `aim index`"}))
        return 1
    conn = sqlite3.connect(f"file:{DB.as_posix()}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    q = lambda sql: [dict(r) for r in conn.execute(sql)]  # noqa: E731
    out = {
        "totals": {
            "memories": conn.execute("SELECT COUNT(*) FROM memories").fetchone()[0],
            "edges": conn.execute("SELECT COUNT(*) FROM edges").fetchone()[0],
        },
        "by_type": {r["type"]: r["n"] for r in q("SELECT type, COUNT(*) n FROM memories GROUP BY type ORDER BY n DESC")},
        "edge_kinds": {r["kind"]: r["n"] for r in q("SELECT kind, COUNT(*) n FROM edges GROUP BY kind ORDER BY n DESC")},
        "recent": q("SELECT id, type, title, updated FROM memories ORDER BY updated DESC LIMIT 8"),
        "top_hubs": q(
            "SELECT m.id, m.title, m.type, d.degree FROM (SELECT id, COUNT(*) degree FROM "
            "(SELECT src id FROM edges UNION ALL SELECT dst FROM edges) GROUP BY id) d "
            "JOIN memories m ON m.id = d.id ORDER BY d.degree DESC LIMIT 5"
        ),
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
