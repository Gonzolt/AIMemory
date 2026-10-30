"""Register the aimemory MCP server in Claude Code, Codex CLI and Cursor, and put `aim` on PATH.

Idempotent. Every config it edits is first backed up to <file>.bak.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
from pathlib import Path

PYTHON = sys.executable
ROOT = Path(__file__).resolve().parent.parent
HOME = Path.home()

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # ✓ on Windows consoles


def _backup(p: Path) -> None:
    if p.exists():
        shutil.copy2(p, p.with_name(p.name + ".bak"))


def _server_entry() -> dict:
    return {"command": PYTHON, "args": ["-m", "server.mcp_server"], "env": {"PYTHONPATH": str(ROOT)}}


def install_path() -> None:
    bindir = HOME / ".local" / "bin"
    bindir.mkdir(parents=True, exist_ok=True)
    target = ROOT / "bin" / "aim"
    if sys.platform == "win32":
        (bindir / "aim.cmd").write_text(f'@"{PYTHON}" "{target}" %*\r\n', encoding="utf-8")
        (bindir / "aim").write_text(f'#!/bin/sh\nexec "{Path(PYTHON).as_posix()}" "{target.as_posix()}" "$@"\n',
                                    encoding="utf-8", newline="\n")
        print(f"✓ PATH: {bindir / 'aim.cmd'} (+ sh wrapper) → {target}")
        return
    link = bindir / "aim"
    if link.is_symlink() or link.exists():
        link.unlink()
    link.symlink_to(target)
    os.chmod(target, 0o755)
    print(f"✓ PATH: {link} → {target}")


def install_claude_code() -> None:
    p = HOME / ".claude.json"
    if not p.exists():
        print("• Claude Code: ~/.claude.json not found, skipped")
        return
    _backup(p)
    data = json.loads(p.read_text(encoding="utf-8"))
    data.setdefault("mcpServers", {})["aimemory"] = {"type": "stdio", **_server_entry()}
    p.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"✓ Claude Code: mcpServers.aimemory in {p}")


def _strip_codex_block(text: str) -> str:
    """Drop [mcp_servers.aimemory] and its sub-tables, but keep hand-added tools.* approvals."""
    out, dropping = [], False
    for line in text.splitlines():
        m = re.match(r"^\s*\[\s*([^\]]+?)\s*\]\s*$", line)
        if m:
            name = m.group(1).strip().strip('"')
            if name == "mcp_servers.aimemory" or (name.startswith("mcp_servers.aimemory.")
                                                  and not name.startswith("mcp_servers.aimemory.tools.")):
                dropping = True
                continue
            dropping = False
        if not dropping:
            out.append(line)
    while out and not out[-1].strip():
        out.pop()
    return "\n".join(out)


def install_codex() -> None:
    d = HOME / ".codex"
    if not d.exists():
        print("• Codex: ~/.codex not found, skipped")
        return
    p = d / "config.toml"
    _backup(p)
    text = _strip_codex_block(p.read_text(encoding="utf-8")) if p.exists() else ""
    block = (
        "[mcp_servers.aimemory]\n"
        f"command = {json.dumps(PYTHON)}\n"
        'args = ["-m", "server.mcp_server"]\n'
        f"env = {{ PYTHONPATH = {json.dumps(str(ROOT))} }}\n"
    )
    p.write_text((text + "\n\n" if text else "") + block, encoding="utf-8")
    print(f"✓ Codex: [mcp_servers.aimemory] in {p}")


def install_cursor() -> None:
    d = HOME / ".cursor"
    if not d.exists():
        print("• Cursor: ~/.cursor not found, skipped")
        return
    p = d / "mcp.json"
    _backup(p)
    data = json.loads(p.read_text(encoding="utf-8")) if p.exists() and p.read_text(encoding="utf-8").strip() else {}
    data.setdefault("mcpServers", {})["aimemory"] = _server_entry()
    p.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"✓ Cursor: mcpServers.aimemory in {p}")


def run() -> None:
    for step in (install_path, install_claude_code, install_codex, install_cursor):
        try:
            step()
        except Exception as e:
            print(f"✗ {step.__name__}: {e!r}")
    print("Restart Claude Code / Codex / Cursor to pick up the new MCP server.")


if __name__ == "__main__":
    run()
