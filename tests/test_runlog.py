"""Unit tests for the runner's diagnostic-log mirror (app/runlog.py).

Pins the pure behaviour: size-based rotation, the backup cap, the write-through tee,
attribute fall-through, and the fail-open contract when the log directory is unusable.
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.runlog import RotatingLogFile, TeeStream, install_run_log  # noqa: E402


# --- RotatingLogFile -------------------------------------------------------------------


def test_rotation_rolls_the_file_once_it_would_exceed_max_bytes(tmp_path):
    path = tmp_path / "runner.log"
    log = RotatingLogFile(path, max_bytes=20, backup_count=3)

    log.write("a" * 15)  # under the cap, no rotation yet
    assert not (tmp_path / "runner.log.1").exists()

    log.write("b" * 15)  # 15 + 15 > 20 -> rotate first, then write
    log.close()

    assert (tmp_path / "runner.log.1").read_text() == "a" * 15
    assert path.read_text() == "b" * 15


def test_rotation_keeps_at_most_backup_count_files(tmp_path):
    path = tmp_path / "runner.log"
    log = RotatingLogFile(path, max_bytes=10, backup_count=2)

    for i in range(5):
        log.write(f"{i}" * 10)
    log.close()

    assert (tmp_path / "runner.log.1").exists()
    assert (tmp_path / "runner.log.2").exists()
    assert not (tmp_path / "runner.log.3").exists()
    # Newest rotation wins .1, the oldest surviving backup is .2.
    assert (tmp_path / "runner.log.1").read_text() == "3" * 10
    assert (tmp_path / "runner.log.2").read_text() == "2" * 10


def test_backup_count_zero_truncates_in_place(tmp_path):
    path = tmp_path / "runner.log"
    log = RotatingLogFile(path, max_bytes=10, backup_count=0)

    log.write("x" * 8)
    log.write("y" * 8)  # would exceed -> truncate, then write
    log.close()

    assert path.read_text() == "y" * 8
    assert not (tmp_path / "runner.log.1").exists()


def test_max_bytes_zero_disables_rotation(tmp_path):
    path = tmp_path / "runner.log"
    log = RotatingLogFile(path, max_bytes=0, backup_count=3)

    log.write("z" * 100)
    log.write("z" * 100)
    log.close()

    assert len(path.read_text()) == 200
    assert not (tmp_path / "runner.log.1").exists()


def test_appends_to_an_existing_file(tmp_path):
    path = tmp_path / "runner.log"
    path.write_text("previous run\n")

    log = RotatingLogFile(path, max_bytes=1_000, backup_count=3)
    log.write("this run\n")
    log.close()

    assert path.read_text() == "previous run\nthis run\n"


# --- TeeStream -------------------------------------------------------------------------


def test_tee_writes_to_both_streams_and_returns_primary_count():
    primary = io.StringIO()
    secondary = io.StringIO()
    tee = TeeStream(primary, secondary)  # StringIO is close enough for the write/flush API

    n = tee.write("hello")
    tee.flush()

    assert n == len("hello")
    assert primary.getvalue() == "hello"
    assert secondary.getvalue() == "hello"


def test_tee_attribute_access_falls_through_to_primary():
    class Primary(io.StringIO):
        def isatty(self) -> bool:
            return True

    tee = TeeStream(Primary(), io.StringIO())
    assert tee.isatty() is True


def test_tee_survives_a_failing_secondary():
    class Boom:
        def write(self, _text):  # noqa: ANN001
            raise OSError("disk full")

        def flush(self):
            raise OSError("disk full")

    primary = io.StringIO()
    tee = TeeStream(primary, Boom())

    tee.write("still logged to console")
    tee.flush()

    assert primary.getvalue() == "still logged to console"


# --- install_run_log ----------------------------------------------------------------


def test_install_run_log_tees_stdout_and_teardown_restores(tmp_path):
    original_stdout = sys.stdout
    teardown = install_run_log(directory=tmp_path, filename="runner.log")
    try:
        assert sys.stdout is not original_stdout
        print("cycle narrative line")
    finally:
        teardown()

    assert sys.stdout is original_stdout
    assert "cycle narrative line" in (tmp_path / "runner.log").read_text()


def test_install_run_log_is_fail_open_when_directory_is_unusable(tmp_path):
    # A regular file where a directory is expected: mkdir raises, install must not.
    clash = tmp_path / "not-a-dir"
    clash.write_text("i am a file")

    original_stdout, original_stderr = sys.stdout, sys.stderr
    teardown = install_run_log(directory=clash / "logs")
    try:
        assert sys.stdout is original_stdout
        assert sys.stderr is original_stderr
    finally:
        teardown()  # no-op, must not raise
