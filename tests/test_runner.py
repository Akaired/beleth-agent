"""Unit tests for the resident runner loop (scripts/run_agent.py).

The loop's IO (subprocess cycles, Alpaca clock, Supabase reads/writes) is stubbed;
these tests pin the pure decision logic: cadence resolution, chunked graceful sleep,
the pause-switch semantics, and the subprocess containment contract.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.run_agent import (
    chunked_sleep,
    read_paused,
    run_cycle,
    run_log_config,
    runner_config,
)


class _Stop:
    """Scripted stop flag: returns the queued values in order, then the last one."""

    def __init__(self, *values: bool) -> None:
        self.values = list(values)
        self.last = values[-1] if values else False

    def __call__(self) -> bool:
        if self.values:
            return self.values.pop(0)
        return self.last


# --- runner_config -----------------------------------------------------------------------


def test_runner_config_defaults_without_section():
    cfg = runner_config({})
    assert cfg["open_cycle_interval_minutes"] == 5.0
    assert cfg["closed_heartbeat_interval_minutes"] == 15.0
    assert cfg["pause_poll_seconds"] == 30.0
    assert cfg["cycle_timeout_seconds"] == 600.0


def test_runner_config_reads_overrides():
    cfg = runner_config(
        {
            "runner": {
                "open_cycle_interval_minutes": 2,
                "closed_heartbeat_interval_minutes": 30,
                "pause_poll_seconds": 10,
                "cycle_timeout_seconds": 120,
            }
        }
    )
    assert cfg["open_cycle_interval_minutes"] == 2.0
    assert cfg["closed_heartbeat_interval_minutes"] == 30.0
    assert cfg["pause_poll_seconds"] == 10.0
    assert cfg["cycle_timeout_seconds"] == 120.0


# --- run_log_config --------------------------------------------------------------------


def test_run_log_config_defaults_without_section():
    cfg = run_log_config({})
    assert cfg["enabled"] is True
    assert cfg["directory"] == "/app/logs"
    assert cfg["filename"] == "runner.log"
    assert cfg["max_bytes"] == 5_000_000
    assert cfg["backup_count"] == 5


def test_run_log_config_reads_overrides():
    cfg = run_log_config(
        {
            "runner": {
                "diagnostic_log": {
                    "enabled": False,
                    "dir": "/var/log/beleth",
                    "filename": "agent.log",
                    "max_bytes": 1000,
                    "backup_count": 2,
                }
            }
        }
    )
    assert cfg["enabled"] is False
    assert cfg["directory"] == "/var/log/beleth"
    assert cfg["filename"] == "agent.log"
    assert cfg["max_bytes"] == 1000
    assert cfg["backup_count"] == 2


# --- chunked_sleep -----------------------------------------------------------------------


def test_chunked_sleep_sleeps_in_chunks_until_interval_elapses(monkeypatch):
    slept: list[float] = []
    monkeypatch.setattr("scripts.run_agent.time.sleep", slept.append)
    # Two full checks say "no stop": the whole interval is slept, returns False.
    assert chunked_sleep(2.5, should_stop=_Stop(False, False, False, False)) is False
    assert slept == [1.0, 1.0, 0.5]


def test_chunked_sleep_returns_within_a_second_of_stop(monkeypatch):
    slept: list[float] = []
    monkeypatch.setattr("scripts.run_agent.time.sleep", slept.append)
    # The stop flag fires after the first chunk: no full-interval wait.
    assert chunked_sleep(900.0, should_stop=_Stop(False, True)) is True
    assert slept == [1.0]


# --- read_paused -------------------------------------------------------------------------


def test_read_paused_requires_the_column_to_be_explicitly_true(monkeypatch):
    seen: dict[str, object] = {}

    def fake_fetch(config, *, select):
        seen["select"] = select
        return {"paused": True}

    monkeypatch.setattr("scripts.run_agent.fetch_agent_status", fake_fetch)
    assert read_paused("cfg") is True
    assert seen["select"] == "paused"


def test_read_paused_defaults_to_false_for_missing_row_or_false(monkeypatch):
    monkeypatch.setattr("scripts.run_agent.fetch_agent_status", lambda config, *, select: None)
    assert read_paused("cfg") is False
    monkeypatch.setattr(
        "scripts.run_agent.fetch_agent_status", lambda config, *, select: {"paused": False}
    )
    assert read_paused("cfg") is False


def test_read_paused_false_without_supabase():
    # Local/dev runs without Supabase: no switch exists, so the runner is not paused.
    assert read_paused(None) is False


# --- run_cycle (subprocess containment) --------------------------------------------------


def test_run_cycle_returns_true_on_zero_exit_and_prints_output(monkeypatch, capsys):
    def fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(args, 0, stdout="cycle narrative", stderr="")

    monkeypatch.setattr("scripts.run_agent.subprocess.run", fake_run)
    assert run_cycle("SPY", timeout_seconds=600.0) is True
    out = capsys.readouterr().out
    assert "cycle start: SPY" in out
    assert "cycle narrative" in out


def test_run_cycle_returns_false_on_nonzero_exit_and_keeps_going(monkeypatch, capsys):
    def fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(args, 3, stdout="", stderr="boom")

    monkeypatch.setattr("scripts.run_agent.subprocess.run", fake_run)
    assert run_cycle("SPY", timeout_seconds=600.0) is False
    assert "exited 3" in capsys.readouterr().out


def test_run_cycle_kills_a_hung_cycle_and_returns_false(monkeypatch, capsys):
    def fake_run(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="cycle", timeout=600)

    monkeypatch.setattr("scripts.run_agent.subprocess.run", fake_run)
    assert run_cycle("SPY", timeout_seconds=600.0) is False
    assert "exceeded 600s" in capsys.readouterr().out


def test_run_cycle_invokes_the_cycle_script_for_the_symbol(monkeypatch):
    calls: list[tuple[list[str], dict[str, object]]] = []

    def fake_run(cmd, **kwargs):
        calls.append((cmd, kwargs))
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr("scripts.run_agent.subprocess.run", fake_run)
    run_cycle("QQQ", timeout_seconds=60.0)
    cmd, kwargs = calls[0]
    assert cmd[-2:] == [str(cmd[-2]), "QQQ"] or cmd[-1] == "QQQ"
    assert str(cmd[-2]).endswith("check_market_data.py")
    assert kwargs["timeout"] == 60.0
    assert kwargs["cwd"].endswith("beleth-agent")
