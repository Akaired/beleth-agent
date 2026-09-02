"""Measuring the market, before the account is looked at.

Everything in `MarketEvidence` comes from here: the underlying's price and realized
volatility, the VIX regime, the option chain, the term structure, the per-tenor VRP,
the macro-calendar gate, and the candidates that survive all three.

Two of the gates are enforced here rather than merely reported, and that is the point of
doing this before the account:

* **R2 — backwardation.** An inverted term structure blocks every new short-premium
  position. Enforced by not building the candidates at all, so the LLM layer never sees
  a backwardation candidate to be tempted by.
* **R3 — macro calendar.** A tenor whose expiry crosses a known event inside the window
  is dropped the same way.

A tenor that fails the VRP threshold is also simply not built. The evidence package
still reports every tenor's reading, so a no-trade cycle can say which threshold it
missed and by how much.
"""

from __future__ import annotations

import sys

from app.cycle.context import Clients, CycleConfig, MarketEvidence
from app.market.calendar import blocked_tenors, load_macro_events, next_macro_event
from app.market.realized_vol import realized_vol_for_windows
from app.market.term_structure import atm_iv_for_expiry, classify
from app.market.underlying import fetch_daily_closes, fetch_last_price
from app.market.vix import VixDataUnavailable, fetch_vix_history, summarize_regime
from app.options.chain import fetch_chain_for_ladder
from app.options.spreads import build_candidates
from app.vrp import scan_tenors


def gather_market_evidence(clients: Clients, cfg: CycleConfig) -> MarketEvidence:
    strategy = cfg.strategy
    tenor_cfg = strategy["tenor_scan"]
    rv_cfg = strategy["realized_vol"]
    vix_cfg = strategy["vix"]
    regime_cfg = strategy["regime"]
    cal_cfg = strategy["macro_calendar"]
    structure = strategy["structure"]
    dte_ladder = tenor_cfg["dte_ladder"]

    # --- underlying: last price + realized vol ---------------------------------------
    last_price = fetch_last_price(clients.stocks, cfg.symbol)
    closes = fetch_daily_closes(
        clients.stocks, cfg.symbol, lookback_days=max(rv_cfg["windows_days"]) * 3 + 30
    )
    realized_vols = realized_vol_for_windows(
        closes, rv_cfg["windows_days"], rv_cfg["annualization_trading_days"]
    )
    rv20 = realized_vols.get(20)
    rv20_value = rv20.value if rv20 is not None else None

    # --- VIX regime (FRED) -----------------------------------------------------------
    # An absent VIX never blocks trading — it changes how R9 sizes, and the reason has
    # to reach the persisted decision, so it is carried as a value, not raised.
    vix_regime = None
    vix_error = None
    try:
        history = fetch_vix_history(vix_cfg["fred_csv_url"], vix_cfg.get("cboe_fallback_url"))
        vix_regime = summarize_regime(history, vix_cfg["lookback_trading_days"])
    except VixDataUnavailable as exc:
        vix_error = str(exc)
        print(f"WARNING: VIX data unavailable — {exc}", file=sys.stderr)

    # --- chain, term structure, per-tenor VRP ----------------------------------------
    chain = fetch_chain_for_ladder(clients.options, cfg.symbol, dte_ladder)
    tol = tenor_cfg["atm_strike_tolerance_pct"]
    short_iv = atm_iv_for_expiry(chain, min(dte_ladder), cfg.today_ordinal, last_price, tol)
    long_iv = atm_iv_for_expiry(chain, max(dte_ladder), cfg.today_ordinal, last_price, tol)
    term_structure = classify(
        short_iv,
        long_iv,
        min(dte_ladder),
        max(dte_ladder),
        regime_cfg["term_structure_flat_band_iv"],
    )

    tenor_vrp = scan_tenors(
        chain,
        dte_ladder=dte_ladder,
        today_ordinal=cfg.today_ordinal,
        underlying_last=last_price,
        rv20=rv20_value,
        threshold_vol_points=tenor_cfg["vrp_threshold_vol_points"],
        strike_tolerance_pct=tol,
    )

    # --- macro calendar gate ---------------------------------------------------------
    events = load_macro_events(cal_cfg["events_file"])
    next_event = next_macro_event(events, cfg.now_et)
    blocks = blocked_tenors(events, dte_ladder, cfg.now_et, cal_cfg["block_within_days"])
    blocked_dtes = {b.dte for b in blocks}

    # --- candidates: only tenors that clear VRP and are not gate-blocked --------------
    backwardation_block = (
        regime_cfg["block_new_shorts_on_backwardation"] and term_structure.state == "backwardation"
    )
    tradable_dtes = [
        t.dte
        for t in tenor_vrp
        if t.passes_threshold and t.dte not in blocked_dtes and not backwardation_block
    ]
    candidates = build_candidates(
        chain,
        underlying=cfg.symbol,
        target_dtes=tradable_dtes,
        today_ordinal=cfg.today_ordinal,
        delta_min=structure["short_leg_delta_min"],
        delta_max=structure["short_leg_delta_max"],
        width_min=structure["strike_width_usd_min"],
        width_max=structure["strike_width_usd_max"],
    )

    return MarketEvidence(
        underlying_last=last_price,
        realized_vols=realized_vols,
        rv20=rv20_value,
        vix_regime=vix_regime,
        vix_error=vix_error,
        chain=chain,
        term_structure=term_structure,
        tenor_vrp=tenor_vrp,
        next_event=next_event,
        blocked_tenors=blocks,
        blocked_dtes=blocked_dtes,
        backwardation_block=backwardation_block,
        candidates=candidates,
    )
