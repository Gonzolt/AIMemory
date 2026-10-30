#!/usr/bin/env bash
# One-shot AIMemory installer. Idempotent.
#   bash scripts/install.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PY="$(command -v python3 || command -v python || true)"
if [ -z "$PY" ]; then
  echo "✗ python3 is required (3.11+)" >&2
  exit 1
fi
"$PY" -c 'import sys; assert sys.version_info >= (3, 11), "Python 3.11+ required"'

echo "→ Python deps"
case "$(uname -s)" in
  Darwin) "$PY" -m pip install --user --break-system-packages -q "mcp>=1.27,<2" httpx watchdog uvicorn starlette websockets ;;
  *)      "$PY" -m pip install --user -q "mcp>=1.27,<2" httpx watchdog uvicorn starlette websockets ;;
esac

echo "→ Graph UI deps"
for pm in pnpm bun npm; do
  if command -v "$pm" >/dev/null 2>&1; then
    (cd graph && "$pm" install --silent) || echo "  ($pm install failed; run it by hand in graph/)"
    break
  fi
done

echo "→ Index"
"$PY" bin/aim init

echo "→ MCP clients"
"$PY" scripts/install_clients.py

echo
echo "✓ Done. Restart Claude Code / Codex / Cursor."
echo "  aim start    # watcher + API in the background"
echo "  aim graph    # live graph UI on http://localhost:5471"
echo "  aim galaxy   # 3D galaxy (after: pnpm --prefix graph run build)"
