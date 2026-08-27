#!/usr/bin/env python3
"""Run the pre-trade risk check (R4 / R6 / R7) against real account state and print verdicts.

Read-only end to end: reads equity / open positions / day P&L from the paper account, builds
defined-risk spread candidates from the live SPY chain across the *whole* DTE ladder (not just
the tenors that clear the VRP threshold — the point here is to exercise the risk gate, not to
produce a trade signal), runs each candidate through the risk check, and prints the verdicts.
Places no orders and calls no LLM.

Usage:
    python3 scripts/check_risk.py [SYMBOL]
"""

from __future__ import annotations

import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.alpaca_client import (  # noqa: E402
    assert_paper_trading,
    get_option_data_client,
    get_stock_data_client,
    get_trading_client,
)
from app.config import ConfigError, get_settings, load_strategy_config  # noqa: E402
from app.market.underlying import fetch_last_price  # noqa: E402
from app.options.chain import fetch_chain_for_ladder  # noqa: E402
from app.options.spreads import build_candidates  # noqa: E402
from app.risk_check import AccountRiskState, evaluate_candidates  # noqa: E402


def main() -> int:
    symbol = sys.argv[1] if len(sys.argv) > 1 else "SPY"

    try:
        settings = get_settings()
    except ConfigError as exc:
        print(exc, file=sys.stderr)
        return 1

    strategy = load_strategy_config()
    tenor_cfg = strategy["tenor_scan"]
    structure = strategy["structure"]
    dte_ladder = tenor_cfg["dte_ladder"]
    today_ordinal = datetime.now().toordinal()

    trading = get_trading_client(settings)
    assert_paper_trading(trading)  # never a live endpoint — constraint #1
    option_client = get_option_data_client(settings)
    stock_client = get_stock_data_client(settings)
    last_price = fetch_last_price(stock_client, symbol)

    chain = fetch_chain_for_ladder(option_client, symbol, dte_ladder)
    candidates = build_candidates(
        chain,
        underlying=symbol,
        target_dtes=dte_ladder,  # whole ladder on purpose — see module docstring
        today_ordinal=today_ordinal,
        delta_min=structure["short_leg_delta_min"],
        delta_max=structure["short_leg_delta_max"],
        width_min=structure["strike_width_usd_min"],
        width_max=structure["strike_width_usd_max"],
    )

    account = trading.get_account()
    positions = trading.get_all_positions()
    equity = float(account.equity)
    day_pnl = equity - float(account.last_equity)
    state = AccountRiskState(
        equity=equity,
        open_positions=len(positions),
        day_pnl=round(day_pnl, 2),
        capital_at_risk=0.0,  # per-spread max loss arrives with the Supabase decision log
    )

    verdicts = evaluate_candidates(candidates, state, strategy)

    print(
        json.dumps(
            {
                "underlying": {"symbol": symbol, "last": last_price},
                "account": {
                    "equity": round(equity, 2),
                    "open_positions": state.open_positions,
                    "day_pnl": state.day_pnl,
                },
                "verdicts": [v.as_dict() for v in verdicts],
            },
            indent=2,
            default=str,
        )
    )

    print("\n--- summary ---", file=sys.stderr)
    if not verdicts:
        print("No well-formed candidate from the live chain to risk-check.", file=sys.stderr)
    for v in verdicts:
        c = v.candidate
        tag = "APPROVED" if v.approved else "REJECTED (" + ", ".join(v.as_dict()["rejected_by"]) + ")"
        print(
            f"{c['symbol']} {c['right']} {c['expiry']} {c['strikes']} "
            f"max_loss={c['max_loss']} -> {tag}",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
