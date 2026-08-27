#!/usr/bin/env python3
"""Connect to Alpaca paper trading and print account/position state.

Milestone 1, step 3: read-only verification that the Alpaca connection works and that the
account is genuinely a paper account before anything else gets built on top of it.

Usage:
    python3 scripts/check_alpaca_connection.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.alpaca_client import (  # noqa: E402
    assert_paper_trading,
    describe_account,
    get_trading_client,
)
from app.config import ConfigError, get_settings  # noqa: E402


def main() -> int:
    try:
        settings = get_settings()
    except ConfigError as exc:
        print(exc, file=sys.stderr)
        return 1

    client = get_trading_client(settings)

    try:
        assert_paper_trading(client)
    except Exception as exc:  # noqa: BLE001
        print(exc, file=sys.stderr)
        return 1
    print("Paper endpoint confirmed (BaseURL.TRADING_PAPER).\n")

    account = client.get_account()
    print("Account:")
    print(f"  {describe_account(account)}")

    positions = client.get_all_positions()
    print(f"\nOpen positions: {len(positions)}")
    for p in positions:
        print(f"  {p.symbol}: qty={p.qty} market_value={p.market_value}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
