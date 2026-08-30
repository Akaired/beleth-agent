#!/usr/bin/env python3
"""Resident runner loop for the Beleth agent (milestone 8).

Runs one full analysis cycle per configured symbol by invoking the already-tested
one-shot script (``scripts/check_market_data.py``) as a subprocess: a fresh
interpreter per cycle means any crash, hang, or leaked state dies with the
subprocess while the loop survives — per-cycle exception containment.

Behaviour:
- Market hours come from the Alpaca clock (America/New_York); full cycles run only
  while the market is open. Outside hours the loop sleeps on a slower heartbeat and
  upserts ``agent_status.state='idle'`` so the dashboard can tell "alive, market
  closed" from "agent down". No decision rows are persisted overnight.
- The master-admin pause switch is honored every iteration by reading
  ``agent_status.paused`` — a column the agent never writes (see app/persistence.py).
  An unreadable status row fails closed: no cycles until the switch can be read.
- SIGTERM / SIGINT stop the loop gracefully: handlers only set a flag, sleeps are
  chunked so exit happens within about a second, and in-flight cycles are waited out.

All cadence parameters live in ``config/strategy.yaml`` (``runner:``).
"""

from __future__ import annotations

import signal
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from app.alpaca_client import get_trading_client  # noqa: E402
from app.config import ConfigError, get_settings, load_strategy_config  # noqa: E402
from app.hostinfo import (  # noqa: E402
    collect_host_metrics,
    new_runner_stats,
    write_runner_stats,
)
from app.runlog import install_run_log  # noqa: E402
from app.persistence import (  # noqa: E402
    PersistenceError,
    agent_status_row,
    fetch_agent_status,
    persist_agent_status,
    record_host_metrics,
    supabase_config_from_settings,
)

CYCLE_SCRIPT = REPO_ROOT / "scripts" / "check_market_data.py"

# Fallbacks only — the real values live in config/strategy.yaml under ``runner:``.
DEFAULT_OPEN_CYCLE_MINUTES = 5.0
DEFAULT_CLOSED_HEARTBEAT_MINUTES = 15.0
DEFAULT_PAUSE_POLL_SECONDS = 30.0
DEFAULT_CYCLE_TIMEOUT_SECONDS = 600.0

# Diagnostic-log fallbacks — real values in config/strategy.yaml (``runner.diagnostic_log``).
DEFAULT_LOG_DIR = "/app/logs"
DEFAULT_LOG_FILENAME = "runner.log"
DEFAULT_LOG_MAX_BYTES = 5_000_000
DEFAULT_LOG_BACKUP_COUNT = 5


class _StopRequested:
    """Callable stop flag set by signal handlers, checked everywhere the loop waits."""

    def __init__(self) -> None:
        self.flag = False

    def __call__(self) -> bool:
        return self.flag


def chunked_sleep(seconds: float, *, should_stop: Callable[[], bool]) -> bool:
    """Sleep in ~1 s chunks; return True as soon as a stop is requested.

    A plain ``time.sleep(interval)`` would turn SIGTERM into a full-interval wait —
    chunking makes a graceful stop take about a second instead.
    """
    remaining = max(0.0, float(seconds))
    while remaining > 0.0 and not should_stop():
        step = min(1.0, remaining)
        time.sleep(step)
        remaining -= step
    return should_stop()


def runner_config(strategy: Mapping[str, Any]) -> dict[str, float]:
    """Cadence knobs from ``config/strategy.yaml`` (``runner:``) with code fallbacks."""
    cfg = strategy.get("runner") or {}
    return {
        "open_cycle_interval_minutes": float(
            cfg.get("open_cycle_interval_minutes", DEFAULT_OPEN_CYCLE_MINUTES)
        ),
        "closed_heartbeat_interval_minutes": float(
            cfg.get("closed_heartbeat_interval_minutes", DEFAULT_CLOSED_HEARTBEAT_MINUTES)
        ),
        "pause_poll_seconds": float(cfg.get("pause_poll_seconds", DEFAULT_PAUSE_POLL_SECONDS)),
        "cycle_timeout_seconds": float(cfg.get("cycle_timeout_seconds", DEFAULT_CYCLE_TIMEOUT_SECONDS)),
    }


def run_log_config(strategy: Mapping[str, Any]) -> dict[str, Any]:
    """Diagnostic-log settings from ``config/strategy.yaml`` (``runner.diagnostic_log``).

    Missing section or missing keys fall back to the module defaults; ``enabled`` false
    turns the on-disk mirror off entirely (console output is unchanged).
    """
    cfg = ((strategy.get("runner") or {}).get("diagnostic_log")) or {}
    return {
        "enabled": bool(cfg.get("enabled", True)),
        "directory": str(cfg.get("dir", DEFAULT_LOG_DIR)),
        "filename": str(cfg.get("filename", DEFAULT_LOG_FILENAME)),
        "max_bytes": int(cfg.get("max_bytes", DEFAULT_LOG_MAX_BYTES)),
        "backup_count": int(cfg.get("backup_count", DEFAULT_LOG_BACKUP_COUNT)),
    }


def read_paused(supabase_config: Any) -> bool:
    """True only when the master-admin switch is explicitly on.

    The agent never writes ``agent_status.paused`` (app/persistence.py). A missing
    status row or a Supabase-less setup means "not paused" — the switch only bites
    when the column says so; a *failed read* is handled by the caller as fail-closed.
    """
    if supabase_config is None:
        return False
    row = fetch_agent_status(supabase_config, select="paused")
    return bool(row and row.get("paused") is True)


def send_heartbeat(supabase_config: Any, runner_stats: Mapping[str, Any] | None = None) -> bool:
    """Upsert ``agent_status`` state='idle' outside market hours so the dashboard can
    tell "alive, market closed" from "agent down". Never writes ``paused``. Carries the
    host snapshot so the backoffice "Host" panel stays live while the market is closed.
    Returns True when persisted; False when Supabase is not configured."""
    if supabase_config is None:
        return False
    persist_agent_status(
        supabase_config,
        agent_status_row(
            state="idle",
            last_cycle_at=datetime.now(timezone.utc),
            detail={
                "runner": "heartbeat",
                "market_open": False,
                "host": collect_host_metrics(runner_stats),
            },
        ),
    )
    return True


def record_host_history(supabase_config: Any, runner_stats: Mapping[str, Any]) -> None:
    """Append one trailing ``host_metrics`` row (fail-open). The live value is written
    into ``agent_status.detail['host']`` by the heartbeat and by every cycle; this is
    only the 48 h history the backoffice sparklines read."""
    if supabase_config is None:
        return
    try:
        record_host_metrics(supabase_config, collect_host_metrics(runner_stats))
    except Exception as exc:  # noqa: BLE001 — history is best-effort, never fatal
        print(f"WARNING: host-metrics history append failed ({exc})", flush=True)


def run_cycle(symbol: str, *, timeout_seconds: float) -> bool:
    """One full cycle for one symbol, in a fresh interpreter. True on exit 0.

    The subprocess isolates the loop from anything a cycle does — an unhandled
    exception, an API hang, a hung connection — at the cost of one interpreter start.
    """
    started = datetime.now(timezone.utc).astimezone()
    print(f"--- [{started:%Y-%m-%d %H:%M:%S}] cycle start: {symbol} ---", flush=True)
    try:
        result = subprocess.run(
            [sys.executable, str(CYCLE_SCRIPT), symbol],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
    except subprocess.TimeoutExpired:
        print(
            f"ERROR: cycle for {symbol} exceeded {timeout_seconds:.0f}s — killed; "
            "loop continues with the next interval",
            flush=True,
        )
        return False
    except OSError as exc:
        print(f"ERROR: could not start cycle for {symbol}: {exc}", flush=True)
        return False
    if result.stdout:
        print(result.stdout.rstrip(), flush=True)
    if result.stderr:
        print(result.stderr.rstrip(), flush=True)
    if result.returncode != 0:
        print(
            f"ERROR: cycle for {symbol} exited {result.returncode} — loop continues",
            flush=True,
        )
        return False
    return True


def main() -> int:
    stop = _StopRequested()

    def _request_stop(signum: int, _frame: object) -> None:
        stop.flag = True

    signal.signal(signal.SIGTERM, _request_stop)
    signal.signal(signal.SIGINT, _request_stop)

    try:
        settings = get_settings()
        strategy = load_strategy_config()
    except ConfigError as exc:
        print(exc, file=sys.stderr)
        return 1

    log_cfg = run_log_config(strategy)
    stop_logging: Callable[[], None] = lambda: None  # noqa: E731
    if log_cfg["enabled"]:
        # Tee stdout/stderr to a rotating file in a volume-backed dir so the diagnostic
        # stream outlives a container recreation (Docker's json-file logs do not).
        stop_logging = install_run_log(
            directory=log_cfg["directory"],
            filename=log_cfg["filename"],
            max_bytes=log_cfg["max_bytes"],
            backup_count=log_cfg["backup_count"],
        )

    cfg = runner_config(strategy)
    symbols = [
        str(symbol).upper()
        for symbol in ((strategy.get("universe") or {}).get("symbols") or ["SPY"])
    ]

    try:
        supabase = supabase_config_from_settings(settings)
    except PersistenceError as exc:
        print(
            f"WARNING: Supabase unconfigured — pause switch and heartbeat disabled ({exc})",
            flush=True,
        )
        supabase = None

    client = get_trading_client(settings)

    # Runner-owned stats the cycle subprocess cannot know (uptime, cycle count, last
    # network round-trips). Flushed to the logs volume every loop so the cycle path can
    # fold them into agent_status.detail['host'] during market hours too.
    runner_stats = new_runner_stats()
    write_runner_stats(runner_stats)

    print(
        "beleth runner up: " + ", ".join(symbols)
        + f" | open cycles every {cfg['open_cycle_interval_minutes']:.0f} min"
        + f" | closed heartbeat every {cfg['closed_heartbeat_interval_minutes']:.0f} min"
        + f" | cycle timeout {cfg['cycle_timeout_seconds']:.0f} s",
        flush=True,
    )

    paused_logged = False
    while not stop():
        try:
            _t0 = time.monotonic()
            clock = client.get_clock()
            runner_stats["net"]["alpaca_ms"] = int((time.monotonic() - _t0) * 1000)
            market_open = bool(clock.is_open)
        except Exception as exc:  # noqa: BLE001 — a clock failure must not kill the loop
            print(f"WARNING: market clock unavailable ({exc}) — retrying in 60 s", flush=True)
            chunked_sleep(60, should_stop=stop)
            continue

        try:
            paused = read_paused(supabase)
        except PersistenceError as exc:
            # Fail closed on the kill switch: if it cannot be read, do not run cycles.
            print(
                f"WARNING: pause switch unreadable ({exc}) — cycles skipped this poll",
                flush=True,
            )
            paused = True

        if paused:
            if not paused_logged:
                print("paused via agent_status.paused — cycles suspended (polling)", flush=True)
                paused_logged = True
            chunked_sleep(cfg["pause_poll_seconds"], should_stop=stop)
            continue
        paused_logged = False

        if market_open:
            for symbol in symbols:
                if stop():
                    break
                run_cycle(symbol, timeout_seconds=cfg["cycle_timeout_seconds"])
                runner_stats["cycles"] += 1
                runner_stats["last_symbol"] = symbol
            write_runner_stats(runner_stats)
            record_host_history(supabase, runner_stats)
            chunked_sleep(cfg["open_cycle_interval_minutes"] * 60, should_stop=stop)
        else:
            try:
                _t0 = time.monotonic()
                sent = send_heartbeat(supabase, runner_stats)
                if sent:
                    runner_stats["net"]["supabase_ms"] = int((time.monotonic() - _t0) * 1000)
                print(
                    f"[{datetime.now(timezone.utc):%Y-%m-%d %H:%M:%SZ}] market closed — heartbeat "
                    + ("persisted to agent_status" if sent else "(Supabase off, logged only)"),
                    flush=True,
                )
            except PersistenceError as exc:
                print(f"WARNING: heartbeat persist failed ({exc})", flush=True)
            write_runner_stats(runner_stats)
            record_host_history(supabase, runner_stats)
            sleep_seconds = cfg["closed_heartbeat_interval_minutes"] * 60
            # Near the open, wake at the bell instead of drifting a full heartbeat past it.
            next_open = getattr(clock, "next_open", None)
            if next_open is not None:
                until_open = (next_open - datetime.now(timezone.utc)).total_seconds() + 30
                sleep_seconds = min(sleep_seconds, max(until_open, 60))
            chunked_sleep(sleep_seconds, should_stop=stop)

    print("runner stopped gracefully", flush=True)
    stop_logging()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())