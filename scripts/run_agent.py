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
from app.persistence import (  # noqa: E402
    PersistenceError,
    agent_status_row,
    fetch_agent_status,
    persist_agent_status,
    supabase_config_from_settings,
)

CYCLE_SCRIPT = REPO_ROOT / "scripts" / "check_market_data.py"

# Fallbacks only — the real values live in config/strategy.yaml under ``runner:``.
DEFAULT_OPEN_CYCLE_MINUTES = 5.0
DEFAULT_CLOSED_HEARTBEAT_MINUTES = 15.0
DEFAULT_PAUSE_POLL_SECONDS = 30.0
DEFAULT_CYCLE_TIMEOUT_SECONDS = 600.0


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


def send_heartbeat(supabase_config: Any) -> bool:
    """Upsert ``agent_status`` state='idle' outside market hours so the dashboard can
    tell "alive, market closed" from "agent down". Never writes ``paused``.
    Returns True when persisted; False when Supabase is not configured."""
    if supabase_config is None:
        return False
    persist_agent_status(
        supabase_config,
        agent_status_row(
            state="idle",
            last_cycle_at=datetime.now(timezone.utc),
            detail={"runner": "heartbeat", "market_open": False},
        ),
    )
    return True


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
            market_open = bool(client.get_clock().is_open)
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
            chunked_sleep(cfg["open_cycle_interval_minutes"] * 60, should_stop=stop)
        else:
            try:
                sent = send_heartbeat(supabase)
                print(
                    f"[{datetime.now(timezone.utc):%Y-%m-%d %H:%M:%SZ}] market closed — heartbeat "
                    + ("persisted to agent_status" if sent else "(Supabase off, logged only)"),
                    flush=True,
                )
            except PersistenceError as exc:
                print(f"WARNING: heartbeat persist failed ({exc})", flush=True)
            chunked_sleep(cfg["closed_heartbeat_interval_minutes"] * 60, should_stop=stop)

    print("runner stopped gracefully", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())