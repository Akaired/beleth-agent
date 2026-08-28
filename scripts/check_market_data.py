#!/usr/bin/env python3
"""Run one full agent cycle: evidence, risk gate, decision, order (milestone 6).

Builds the evidence package (milestone 2 pipeline), runs the pre-trade risk gate (R4/R6/R7)
over the candidates it carries, then decides. When the market is open and at least one
candidate survived the gate, the LLM decision layer weighs the evidence and records a
structured choice (decision_source='llm') — it can only pick from the approved list, and its
failure falls back to the deterministic no-trade. Otherwise the deterministic risk-engine
verdict stands (decision_source='risk_engine').

A ``trade`` decision becomes exactly one multi-leg ``mleg`` limit order on the Alpaca paper
account, submitted only after the decision row is persisted: the structure is the chosen
candidate's own two legs (short sell-to-open, long buy-to-open — covered inside the order,
never split), the quantity is sized by ``risk.max_risk_per_trade_pct_of_equity``, and the
limit demands the measured credit minus the configured slippage. Sizing or pricing that
cannot respect the cap fails closed with the reason in the persisted summary; a submission
failure is persisted as a trades row with status 'submission_failed' — rejections are
first-class (the hard constraint #3). Either way the cycle persists the decision
(full evidence package), one risk_checks row per (candidate, rule), the trades row when an
order was attempted, the open-positions mirror, and the agent_status heartbeat.

Persistence is skipped with a stderr warning when Supabase is not configured (read-only
usage keeps working — and then no order is sent either, because an order must never go out
unlogged); a persistence *failure* prints the evidence and exits 1 — persisting the
decision is part of the cycle's contract (the hard constraint #5).

Usage:
    python3 scripts/check_market_data.py [SYMBOL]
"""

from __future__ import annotations

import json
import sys
import uuid
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.alpaca_client import (  # noqa: E402
    get_option_data_client,
    get_stock_data_client,
    get_trading_client,
)
from app.config import ConfigError, get_settings, load_strategy_config  # noqa: E402
from app.decision import decide_from_llm, decide_from_risk_engine  # noqa: E402
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
from app.options.spreads import SpreadCandidate, build_candidates  # noqa: E402
from app.orders import (  # noqa: E402
    OrderSubmissionError,
    build_mleg_order,
    compute_quantity,
    credit_limit_price,
    describe_legs,
    submit_mleg_order,
)
from app.persistence import (  # noqa: E402
    PersistenceConfigError,
    PersistenceError,
    agent_status_row,
    mirror_positions,
    persist_agent_status,
    persist_decision,
    persist_risk_checks,
    persist_trade,
    supabase_config_from_settings,
    trade_row,
)
from app.risk_check import AccountRiskState, evaluate_candidates  # noqa: E402
from app.vrp import best_tradable_tenor, scan_tenors  # noqa: E402


def _match_candidate(
    candidates: list[SpreadCandidate], chosen: dict[str, Any] | None
) -> SpreadCandidate | None:
    """The built candidate a trade decision picked, matched on its own leg symbols (the
    strongest identity a structure has). ``None`` if the decision carried a structure the
    cycle never built — a fail-closed fault, never an order."""
    if chosen is None:
        return None
    for c in candidates:
        if (
            c.right == chosen.get("right")
            and c.expiry == chosen.get("expiry")
            and c.short_symbol == chosen.get("short_symbol")
            and c.long_symbol == chosen.get("long_symbol")
        ):
            return c
    return None


def _prepare_order(
    chosen: dict[str, Any] | None,
    candidates: list[SpreadCandidate],
    *,
    equity: float,
    strategy_config: dict[str, Any],
) -> tuple[dict[str, Any] | None, str]:
    """Turn a ``trade`` decision into the single mleg order it may send — or ``None`` plus
    the fail-closed sentence that goes into the persisted summary instead of an order.

    The plan is *not* submitted here: the caller submits only after the decision row is
    persisted, so no order ever goes out unlogged (the hard constraint #5)."""
    candidate = _match_candidate(candidates, chosen)
    if candidate is None:
        return None, (
            " No order was sent: the decision did not carry a candidate this cycle built "
            "(fail-closed)."
        )

    max_loss = chosen.get("max_loss")
    credit = chosen.get("credit")
    qty = compute_quantity(
        equity,
        strategy_config["risk"]["max_risk_per_trade_pct_of_equity"],
        max_loss,
    )
    slippage = strategy_config["structure"]["credit_slippage_usd"]
    limit_price = credit_limit_price(credit, slippage)

    if qty < 1:
        return None, (
            f" No order was sent: sizing cannot fit even one spread under the per-trade "
            f"risk cap (max loss {max_loss} at {equity:.2f} equity) — fail-closed."
        )
    if limit_price is None:
        return None, (
            f" No order was sent: no fillable net-credit limit exists (credit {credit}, "
            f"slippage {slippage}) — fail-closed."
        )

    request = build_mleg_order(
        candidate, qty, limit_price, client_order_id=f"beleth-{uuid.uuid4().hex}"
    )
    note = (
        f" One multi-leg order ({qty} spread(s) at a {abs(limit_price):.2f} net-credit "
        "limit) is being sent; the trades log carries the outcome."
    )
    return (
        {
            "request": request,
            "qty": qty,
            "credit": abs(limit_price),
            "max_loss": max_loss,
            "legs": describe_legs(candidate),
            "client_order_id": request.client_order_id,
        },
        note,
    )


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

    # --- candidates: only for tenors that clear VRP and aren't gate-blocked -------------
    # R2: an inverted term structure blocks every new short-premium position (enforced here,
    # not just reported — the LLM layer must never even see a backwardation candidate).
    backwardation_block = (
        regime_cfg["block_new_shorts_on_backwardation"]
        and term_structure.state == "backwardation"
    )
    tradable_dtes = [
        t.dte
        for t in tenor_vrp
        if t.passes_threshold
        and t.dte not in blocked_dtes
        and not backwardation_block
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

    # --- risk gate over the candidates the evidence package actually carries -------------
    risk_state = AccountRiskState(
        equity=equity,
        open_positions=len(positions),
        day_pnl=round(day_pnl, 2),
        capital_at_risk=0.0,  # per-position max-loss pairing of open legs lands with R5
    )
    verdicts = evaluate_candidates(candidates, risk_state, strategy)

    # --- decision: the LLM weighs the evidence only when it has something to weigh ------
    as_of = datetime.now(timezone.utc)
    if clock.is_open and any(v.approved for v in verdicts):
        draft = decide_from_llm(
            as_of=as_of,
            symbol=symbol,
            market_open=clock.is_open,
            equity=round(equity, 2),
            day_pnl=round(day_pnl, 2),
            evidence=package,
            strategy_config=strategy,
            verdicts=verdicts,
            settings=settings,
        )
    else:
        draft = decide_from_risk_engine(
            as_of=as_of,
            symbol=symbol,
            market_open=clock.is_open,
            equity=round(equity, 2),
            day_pnl=round(day_pnl, 2),
            evidence=package,
            strategy_config=strategy,
            verdicts=verdicts,
        )

    # --- order path: only a 'trade' decision may become an order, and only through the gate
    # The order is prepared (sized, priced, built) here but submitted only after the
    # decision row is persisted — no order ever goes out unlogged (constraint #5).
    plan: dict[str, Any] | None = None
    if draft.action == "trade":
        plan, order_note = _prepare_order(
            draft.chosen_candidate, candidates, equity=equity, strategy_config=strategy
        )
        draft = replace(draft, summary=draft.summary + order_note)

    # --- persistence: every decision, risk-check outcome and position state (constraint #5) --
    decision_id = None
    persisted_checks = 0
    upserted_positions = 0
    submitted_order: dict[str, Any] | None = None
    order_failure: str | None = None
    try:
        supabase = supabase_config_from_settings(settings)
    except PersistenceConfigError as exc:
        print(
            f"WARNING: Supabase not configured — decision not persisted ({exc})",
            file=sys.stderr,
        )
        if plan is not None:
            # The decision could not be logged, so the order must not go out either.
            print(
                "ERROR: a trade decision was made but persistence is unavailable — "
                "no order is sent (orders never go out unlogged).",
                file=sys.stderr,
            )
    else:
        try:
            decision_id = persist_decision(supabase, draft=draft)
            persisted_checks = persist_risk_checks(
                supabase, decision_id=decision_id, verdicts=verdicts
            )
            upserted_positions, _ = mirror_positions(
                supabase, [p.model_dump(mode="json") for p in positions]
            )

            if plan is not None:
                # The decision is persisted; the prepared order may now go out. A
                # submission failure is persisted as a trades row, not swallowed
                # (the hard constraint #3 — rejections are first-class).
                try:
                    submitted_order = submit_mleg_order(trading, plan["request"])
                except OrderSubmissionError as exc:
                    order_failure = str(exc)
                    print(f"ERROR: order submission failed: {order_failure}", file=sys.stderr)

                persist_trade(
                    supabase,
                    trade_row(
                        decision_id=decision_id,
                        underlying=symbol,
                        qty=plan["qty"],
                        credit=plan["credit"],
                        max_loss=plan["max_loss"],
                        legs=plan["legs"],
                        order=submitted_order,
                        failure=order_failure,
                    ),
                )

            status_state = (
                "trade_executed"
                if submitted_order is not None
                else ("monitoring" if clock.is_open else "idle")
            )
            status_detail: dict[str, Any] = {
                "candidates": len(candidates),
                "risk_checks": persisted_checks,
                "approved": sum(1 for v in verdicts if v.approved),
                "decision_source": draft.decision_source,
            }
            if plan is not None:
                status_detail["order"] = (
                    {
                        "status": submitted_order.get("status"),
                        "alpaca_order_id": submitted_order.get("id"),
                        "qty": plan["qty"],
                    }
                    if submitted_order is not None
                    else {"status": "submission_failed", "error": order_failure}
                )
            persist_agent_status(
                supabase,
                agent_status_row(
                    state=status_state,
                    last_cycle_at=datetime.now(timezone.utc),
                    last_decision_id=decision_id,
                    detail=status_detail,
                ),
            )
        except PersistenceError as exc:
            print(
                f"ERROR: persistence failed — cycle not fully logged: {exc}",
                file=sys.stderr,
            )
            print(json.dumps(package, indent=2, default=str))
            return 1

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

    print("\n--- risk gate ---", file=sys.stderr)
    if not verdicts:
        print("No candidate reached the risk gate (see the no-trade reason above).", file=sys.stderr)
    for v in verdicts:
        c = v.candidate
        tag = "APPROVED" if v.approved else "REJECTED (" + ", ".join(r.rule for r in v.rejections) + ")"
        print(
            f"{c['symbol']} {c['right']} {c['expiry']} {c['strikes']} "
            f"max_loss={c['max_loss']} -> {tag}",
            file=sys.stderr,
        )
    if decision_id is not None:
        print(
            f"\nDecision {decision_id} persisted to Supabase "
            f"({persisted_checks} risk check(s), {upserted_positions} position(s) mirrored).",
            file=sys.stderr,
        )

    print("\n--- decision ---", file=sys.stderr)
    print(f"source={draft.decision_source} action={draft.action}", file=sys.stderr)
    print(draft.summary, file=sys.stderr)
    if submitted_order is not None and plan is not None:
        print(
            f"order: id={submitted_order.get('id')} client_order_id={plan['client_order_id']} "
            f"status={submitted_order.get('status')} qty={plan['qty']} "
            f"limit={plan['credit']} net credit",
            file=sys.stderr,
        )
    elif order_failure is not None:
        print(f"order: SUBMISSION FAILED — {order_failure}", file=sys.stderr)
    if draft.llm_usage is not None:
        usage = draft.llm_usage
        print(
            f"llm tokens: {usage.get('prompt_tokens', 0)} prompt / "
            f"{usage.get('completion_tokens', 0)} completion / "
            f"{usage.get('total_tokens', 0)} total ({draft.llm_model})",
            file=sys.stderr,
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
