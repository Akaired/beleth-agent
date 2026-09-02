"""Mirror the resident runner's stdout/stderr to a rotating on-disk file (P6).

Docker's own ``json-file`` logs are discarded on every ``docker compose up --build`` /
container recreation — the first live day lost roughly an hour of narrative that way.
This module tees the runner's output to a file in a directory that ``compose.yaml``
backs with a named volume, so the diagnostic stream survives a rebuild while the
durable record (decisions / risk_checks / trades in Supabase) stays the source of truth.

It is deliberately dependency-free and fail-open: if the log directory cannot be
created or written, the runner keeps going with console output only.
"""

from __future__ import annotations

import contextlib
import os
import sys
from collections.abc import Callable
from pathlib import Path
from typing import TextIO

DEFAULT_MAX_BYTES = 5_000_000
DEFAULT_BACKUP_COUNT = 5


class RotatingLogFile:
    """Minimal size-based rotating writer — no ``logging`` module, no locks.

    When a write would push the active file past ``max_bytes`` it is rolled:
    ``runner.log`` -> ``runner.log.1`` -> ... -> ``runner.log.<backup_count>`` (the
    oldest is dropped). ``backup_count <= 0`` truncates in place instead of keeping
    history. ``max_bytes <= 0`` disables rotation (the file grows unbounded).
    """

    def __init__(self, path: str | os.PathLike[str], *, max_bytes: int, backup_count: int) -> None:
        self._path = Path(path)
        self._max_bytes = max(0, int(max_bytes))
        self._backup_count = max(0, int(backup_count))
        self._stream: TextIO = open(self._path, "a", encoding="utf-8")  # noqa: SIM115 — the handle outlives __init__ by design
        try:
            self._pos = self._path.stat().st_size
        except OSError:
            self._pos = 0

    def write(self, text: str) -> int:
        if not text:
            return 0
        data_len = len(text.encode("utf-8"))
        if self._max_bytes and self._pos > 0 and self._pos + data_len > self._max_bytes:
            self._rotate()
        written = self._stream.write(text)
        self._stream.flush()
        self._pos += data_len
        return written

    def flush(self) -> None:
        self._stream.flush()

    def close(self) -> None:
        with contextlib.suppress(OSError):
            self._stream.close()

    def _rotate(self) -> None:
        self._stream.close()
        if self._backup_count <= 0:
            open(self._path, "w", encoding="utf-8").close()
        else:
            oldest = self._path.with_name(f"{self._path.name}.{self._backup_count}")
            if oldest.exists():
                with contextlib.suppress(OSError):
                    oldest.unlink()
            for i in range(self._backup_count - 1, 0, -1):
                src = self._path.with_name(f"{self._path.name}.{i}")
                dst = self._path.with_name(f"{self._path.name}.{i + 1}")
                if src.exists():
                    with contextlib.suppress(OSError):
                        os.replace(src, dst)
            with contextlib.suppress(OSError):
                os.replace(self._path, self._path.with_name(f"{self._path.name}.1"))
        self._stream = open(self._path, "a", encoding="utf-8")  # noqa: SIM115 — reopened for the lifetime of the object
        self._pos = 0


class TeeStream:
    """Write-through wrapper: everything goes to ``primary`` and to ``secondary``.

    Only the methods ``print`` touches are implemented; any other attribute access
    (``isatty``, ``encoding``, ``fileno`` ...) falls back to ``primary`` so the wrapped
    object still passes for the real stream. A failure on the secondary is swallowed —
    the console must never go down because the log file did.
    """

    def __init__(self, primary: TextIO, secondary: RotatingLogFile) -> None:
        self._primary = primary
        self._secondary = secondary

    def write(self, text: str) -> int:
        written = self._primary.write(text)
        with contextlib.suppress(OSError):
            self._secondary.write(text)
        return written

    def flush(self) -> None:
        self._primary.flush()
        with contextlib.suppress(OSError):
            self._secondary.flush()

    def __getattr__(self, name: str):
        return getattr(self._primary, name)


def install_run_log(
    *,
    directory: str | os.PathLike[str],
    filename: str = "runner.log",
    max_bytes: int = DEFAULT_MAX_BYTES,
    backup_count: int = DEFAULT_BACKUP_COUNT,
) -> Callable[[], None]:
    """Point ``sys.stdout``/``sys.stderr`` at a tee into ``directory/filename``.

    Returns a teardown callable that restores the original streams and closes the file.
    Never raises: on any filesystem error it warns on the original stderr and returns a
    no-op teardown, leaving the console streams untouched.
    """
    original_stdout, original_stderr = sys.stdout, sys.stderr
    try:
        target_dir = Path(directory)
        target_dir.mkdir(parents=True, exist_ok=True)
        log_file = RotatingLogFile(
            target_dir / filename, max_bytes=max_bytes, backup_count=backup_count
        )
    except OSError as exc:
        print(
            f"WARNING: diagnostic log disabled — cannot use {os.fspath(directory)!s} ({exc})",
            file=original_stderr,
            flush=True,
        )
        return lambda: None

    sys.stdout = TeeStream(original_stdout, log_file)
    sys.stderr = TeeStream(original_stderr, log_file)

    def teardown() -> None:
        sys.stdout, sys.stderr = original_stdout, original_stderr
        log_file.close()

    return teardown
