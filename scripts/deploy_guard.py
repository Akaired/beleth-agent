#!/usr/bin/env python3
"""Refuse a container rebuild while the market is open.

``docker compose up --build`` recreates the container: it drops Docker's json-file
logs and, worse, kills any in-flight cycle and the resting-order guard's live view of
the account — which can leave entry orders resting unguarded. Gate a rebuild on this
script:

    python scripts/deploy_guard.py && docker compose up -d --build

Exit codes: 0 = market closed, safe to rebuild; 2 = market open, rebuild refused;
1 = could not determine (config or Alpaca clock error). ``--force`` turns a refusal
into exit 0 for an emergency fix that genuinely cannot wait for the close.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from app.alpaca_client import get_trading_client  # noqa: E402
from app.config import ConfigError, get_settings  # noqa: E402

EXIT_SAFE = 0
EXIT_ERROR = 1
EXIT_BLOCKED = 2


def deploy_blocked(market_open: bool, *, force: bool) -> tuple[bool, str]:
    """Decide whether a rebuild is allowed. Returns ``(blocked, reason)``."""
    if market_open and not force:
        return True, (
            "market OPEN — refusing to rebuild; it would kill the in-flight cycle. "
            "Wait for the close, or pass --force for an emergency fix."
        )
    if market_open and force:
        return False, "market OPEN — overridden by --force; the in-flight cycle will be killed"
    if force:
        return False, "market closed — safe to rebuild (--force redundant)"
    return False, "market closed — safe to rebuild"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Block a container rebuild during market hours."
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="allow the rebuild even if the market is open (emergency fixes only)",
    )
    args = parser.parse_args()

    try:
        settings = get_settings()
    except ConfigError as exc:
        print(exc, file=sys.stderr)
        return EXIT_ERROR

    try:
        clock = get_trading_client(settings).get_clock()
        market_open = bool(clock.is_open)
    except Exception as exc:  # noqa: BLE001 — any clock failure is inconclusive, not a green light
        print(f"ERROR: could not read the Alpaca clock: {exc}", file=sys.stderr)
        return EXIT_ERROR

    blocked, reason = deploy_blocked(market_open, force=args.force)
    print(reason)
    return EXIT_BLOCKED if blocked else EXIT_SAFE


if __name__ == "__main__":
    raise SystemExit(main())
