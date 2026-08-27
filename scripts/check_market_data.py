#!/usr/bin/env python3
"""Assemble and print the full evidence package (milestone 2).

Read-only end to end: pulls the VIX regime from FRED, realized volatility from real SPY
bars, the IV term structure and per-tenor VRP from the real SPY chain, applies the macro
calendar gate, builds defined-risk spread candidates, reads the paper account, and prints
the assembled evidence package as JSON. Places no orders and calls no LLM.

Usage:
    python3 scripts/check_market_data.py [SYMBOL]
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.alpaca_client import (  # noqa: E402
    get_option_data_client,
    get_stock_data_client,
    get_trading_client,
)
from app.config import ConfigError, get_settings, load_strategy_config  # noqa: E402
from app.evidence import AccountSnapshot, build_evidence_package  # noqa: E402
from app.market.calendar import (  # noqa: E402
    EASTERN,
    blocked_tenors,
    load_macro_events,
    next_macro_event,
)
from app.market.realized_vol import realized_vol_for_windows  # noqa: E402
from app.market.term_structure import atm_iv_for_expiry, classify  # noqa: E402
from app.market.underlying import fetch_daily_closes, fetch_last_price  # noqa: E402
from app.market.vix import VixDataUnavailable, fetch_vix_history, summarize_regime  # noqa: E402
from app.options.chain import fetch_chain_for_ladder  # noqa: E402
from app.options.spreads import build_candidates  # noqa: E402
from app.vrp import best_tradable_tenor, scan_tenors  # noqa: E402


def main() -> int:
    symbol = sys.argv[1] if len(sys.argv) > 1 else "SPY"

    try:
        settings = get_settings()
    except ConfigError as exc:
        print(exc, file=sys.stderr)
        return 1

    strategy = load_strategy_config()
    tenor_cfg = strategy["tenor_scan"]
    rv_cfg = strategy["realized_vol"]
    vix_cfg = strategy["vix"]
    regime_cfg = strategy["regime"]
    cal_cfg = strategy["macro_calendar"]
    structure = strategy["structure"]

    dte_ladder = tenor_cfg["dte_ladder"]
    today_ordinal = datetime.now().toordinal()
    now_et = datetime.now(EASTERN)

    trading = get_trading_client(settings)
    option_client = get_option_data_client(settings)
    stock_client = get_stock_data_client(settings)

    # --- underlying: last price + realized vol ------------------------------------------
    last_price = fetch_last_price(stock_client, symbol)
    closes = fetch_daily_closes(
        stock_client, symbol, lookback_days=max(rv_cfg["windows_days"]) * 3 + 30
    )
    realized_vols = realized_vol_for_windows(
        closes, rv_cfg["windows_days"], rv_cfg["annualization_trading_days"]
    )
    rv20 = realized_vols.get(20)
    rv20_value = rv20.value if rv20 is not None else None

    # --- VIX regime (FRED) -------------------------------------------------------------
    vix_regime = None
    vix_error = None
    try:
        history = fetch_vix_history(
            vix_cfg["fred_csv_url"], vix_cfg.get("cboe_fallback_url")
        )
        vix_regime = summarize_regime(history, vix_cfg["lookback_trading_days"])
    except VixDataUnavailable as exc:
        vix_error = str(exc)
        print(f"WARNING: VIX data unavailable — {exc}", file=sys.stderr)

    # --- chain, term structure, per-tenor VRP ----------------------------------------
    chain = fetch_chain_for_ladder(option_client, symbol, dte_ladder)
    tol = tenor_cfg["atm_strike_tolerance_pct"]
    short_iv = atm_iv_for_expiry(chain, min(dte_ladder), today_ordinal, last_price, tol)
    long_iv = atm_iv_for_expiry(chain, max(dte_ladder), today_ordinal, last_price, tol)
    term_structure = classify(
        short_iv, long_iv, min(dte_ladder), max(dte_ladder),
        regime_cfg["term_structure_flat_band_iv"],
    )

    tenor_vrp = scan_tenors(
        chain,
        dte_ladder=dte_ladder,
        today_ordinal=today_ordinal,
        underlying_last=last_price,
        rv20=rv20_value,
        threshold_vol_points=tenor_cfg["vrp_threshold_vol_points"],
        strike_tolerance_pct=tol,
    )

    # --- macro calendar gate --------------------------------------------------------
    events = load_macro_events(cal_cfg["events_file"])
    next_event = next_macro_event(events, now_et)
    blocks = blocked_tenors(
        events, dte_ladder, now_et, cal_cfg["block_within_days"]
    )
    blocked_dtes = {b.dte for b in blocks}

    # --- candidates: only for tenors that clear VRP and aren't calendar-blocked -------
    tradable_dtes = [
        t.dte for t in tenor_vrp if t.passes_threshold and t.dte not in blocked_dtes
    ]
    candidates = build_candidates(
        chain,
        underlying=symbol,
        target_dtes=tradable_dtes,
        today_ordinal=today_ordinal,
        delta_min=structure["short_leg_delta_min"],
        delta_max=structure["short_leg_delta_max"],
        width_min=structure["strike_width_usd_min"],
        width_max=structure["strike_width_usd_max"],
    )

    # --- account ------------------------------------------------------------------
    account = trading.get_account()
    positions = trading.get_all_positions()
    clock = trading.get_clock()

    equity = float(account.equity)
    last_equity = float(account.last_equity)
    day_pnl = equity - last_equity
    daily_stop = equity * strategy["risk"]["daily_drawdown_stop_pct"] / 100
    # Loss still absorbable today before the daily-drawdown stop trips (never negative).
    risk_budget_remaining_today = max(0.0, daily_stop + min(0.0, day_pnl))

    account_snapshot = AccountSnapshot(
        cash=float(account.cash),
        buying_power=float(account.buying_power),
        open_positions=len(positions),
        day_pnl=round(day_pnl, 2),
        risk_budget_remaining_today=round(risk_budget_remaining_today, 2),
    )

    package = build_evidence_package(
        as_of=datetime.now(timezone.utc),
        market_open=clock.is_open,
        underlying_symbol=symbol,
        underlying_last=last_price,
        realized_vols=realized_vols,
        vix_regime=vix_regime,
        vix_error=vix_error,
        term_structure=term_structure,
        tenor_vrp=tenor_vrp,
        next_event=next_event,
        blocked_tenors=blocks,
        now_et=now_et,
        candidates=candidates,
        account=account_snapshot,
    )

    print(json.dumps(package, indent=2, default=str))

    best = best_tradable_tenor(tenor_vrp)
    print("\n--- summary ---", file=sys.stderr)
    if best is None:
        print(
            "No tenor clears the VRP threshold "
            f"({tenor_cfg['vrp_threshold_vol_points']} vol points) — agent would NOT trade.",
            file=sys.stderr,
        )
    else:
        blocked_note = " (calendar-blocked)" if best.dte in blocked_dtes else ""
        print(
            f"Best tenor by VRP: {best.dte} DTE, "
            f"VRP {best.vrp_vs_rv20:.2f} vol points{blocked_note}.",
            file=sys.stderr,
        )
    if regime_cfg["block_new_shorts_on_backwardation"] and term_structure.state == "backwardation":
        print("Term structure is BACKWARDATION — regime gate blocks new short premium.", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
