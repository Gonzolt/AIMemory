"""Small process helpers that behave the same on macOS, Linux and Windows."""
from __future__ import annotations

import os
import signal
import subprocess
import sys

IS_WINDOWS = sys.platform == "win32"


def detached_kwargs() -> dict:
    """Popen kwargs that start a child in its own session/process group."""
    if IS_WINDOWS:
        flags = subprocess.CREATE_NEW_PROCESS_GROUP | getattr(subprocess, "DETACHED_PROCESS", 0x8)
        return {"creationflags": flags}
    return {"start_new_session": True}


def pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if IS_WINDOWS:
        # os.kill(pid, 0) would send CTRL_C_EVENT on Windows; ask the kernel instead.
        import ctypes

        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        STILL_ACTIVE = 259
        h = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not h:
            return False
        try:
            code = ctypes.c_ulong()
            ok = ctypes.windll.kernel32.GetExitCodeProcess(h, ctypes.byref(code))
            return bool(ok) and code.value == STILL_ACTIVE
        finally:
            ctypes.windll.kernel32.CloseHandle(h)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def process_image(pid: int) -> str | None:
    """Executable path of a running process, or None if gone/unknown."""
    if not pid_alive(pid):
        return None
    if IS_WINDOWS:
        import ctypes
        from ctypes import wintypes

        h = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)
        if not h:
            return None
        try:
            buf = ctypes.create_unicode_buffer(1024)
            size = wintypes.DWORD(len(buf))
            ok = ctypes.windll.kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size))
            return buf.value if ok else None
        finally:
            ctypes.windll.kernel32.CloseHandle(h)
    try:
        return os.readlink(f"/proc/{pid}/exe")
    except OSError:
        r = subprocess.run(["ps", "-p", str(pid), "-o", "comm="], capture_output=True, text=True)
        return r.stdout.strip() or None


def pid_is_python(pid: int) -> bool:
    """True only for a live Python process: pid files outlive reboots and pids get reused."""
    image = process_image(pid)
    return bool(image) and "python" in os.path.basename(image).lower()


def terminate(pid: int) -> bool:
    """SIGTERM (TerminateProcess on Windows). False if the process was already gone."""
    if not pid_alive(pid):
        return False
    try:
        os.kill(pid, signal.SIGTERM)
        return True
    except OSError:
        return False


def which_python() -> str:
    return sys.executable


class FileLock:
    """Exclusive advisory lock on a file (flock on POSIX, msvcrt on Windows)."""

    def __init__(self, path):
        self.path = path
        self.fh = None

    def acquire(self, timeout: float | None = None) -> bool:
        import time

        os.makedirs(os.path.dirname(str(self.path)), exist_ok=True)
        self.fh = open(self.path, "a+")
        deadline = None if timeout is None else time.time() + timeout
        while True:
            try:
                if IS_WINDOWS:
                    import msvcrt

                    self.fh.seek(0)
                    msvcrt.locking(self.fh.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(self.fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return True
            except OSError:
                if deadline is not None and time.time() >= deadline:
                    self.fh.close()
                    self.fh = None
                    return False
                time.sleep(0.25)

    def release(self) -> None:
        if not self.fh:
            return
        try:
            if IS_WINDOWS:
                import msvcrt

                self.fh.seek(0)
                msvcrt.locking(self.fh.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(self.fh.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        self.fh.close()
        self.fh = None
