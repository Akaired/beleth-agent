#!/usr/bin/env python3
"""Run one full agent cycle: evidence, R5 exits, risk gate, decision, orders.

Builds the evidence package (milestone 2 pipeline), pairs the account's open option legs
back into spreads and measures each against the R5 exit rules (app/exits.py), runs the
pre-trade risk gate (R4/R6/R7) over the candidates, then decides. When the market is open
and at least one candidate survived the gate, the LLM decision layer weighs the evidence
and records a structured choice (decision_source='llm') — it can only pick from the
approved list, and its failure falls back to the deterministic no-trade. Otherwise the
deterministic risk-engine verdict stands (decision_source='risk_engine').

Exits are mechanical risk management, never LLM-gated: a triggered close becomes its own
multi-leg ``mleg`` order (buy the short leg back, sell the long leg — one order per
spread, both legs inside it, never a naked leg), prepared only while the market is open
and only when no closing order for the same spread is already working (dedup against open
orders carrying ``*_to_close`` intents). Each closing order's pre-trade check is its
persisted R5 verdict; a failed submission is persisted as a trades row with kind='exit'
— rejections are first-class (the hard constraint #3). Open anomalies (naked legs,
unparseable positions) and spreads without a computable entry credit reject every new
entry through the gate until resolved.

A ``trade`` decision becomes exactly one multi-leg ``mleg`` limit order on the Alpaca paper
account, submitted only after the decision row is persisted: the structure is the chosen
candidate's own two legs (short sell-to-open, long buy-to-open — covered inside the order,
never split), the quantity is sized by ``risk.max_risk_per_trade_pct_of_equity``, and the
limit demands the measured credit minus the configured slippage. Sizing or pricing that
cannot respect the cap fails closed with the reason in the persisted summary; a submission
failure is persisted as a trades row with status 'submission_failed' — rejections are
first-class (the hard constraint #3). Either way the cycle persists the decision
(full evidence package), one risk_checks row per (candidate, rule) plus one per open
spread's R5 verdict, the trades rows when orders were attempted, the open-positions
mirror, and the agent_status heartbeat.

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

from alpaca.trading.enums import QueryOrderStatus  # noqa: E402
from alpaca.trading.requests import GetOrdersRequest  # noqa: E402

from app.alpaca_client import (  # noqa: E402
    get_option_data_client,
    get_stock_data_client,
    get_trading_client,
)
from app.config import ConfigError, get_settings, load_strategy_config  # noqa: E402
from app.decision import decide_from_llm, decide_from_risk_engine  # noqa: E402
from app.evidence import AccountSnapshot, build_evidence_package  # noqa: E402
from app.exits import (  # noqa: E402
    ExitEvaluation,
    evaluate_exit,
    exit_summary_sentences,
    pair_open_spreads,
)
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
from app.options.chain import fetch_chain_for_ladder, fetch_latest_quotes  # noqa: E402
from app.options.spreads import SpreadCandidate, build_candidates  # noqa: E402
from app.orders import (  # noqa: E402
    OrderSubmissionError,
    build_closing_mleg_order,
    build_mleg_order,
    closing_limit_price,
    compute_quantity,
    credit_limit_price,
    describe_closing_legs,
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
    persist_exit_checks,
    persist_risk_checks,
    persist_trade,
    supabase_config_from_settings,
    trade_row,
)
from app.risk_check import AccountRiskState, block_entries, evaluate_candidates  # noqa: E402
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


def working_exit_leg_sets(open_orders: list[Any]) -> set[frozenset[str]]:
    """Leg-symbol sets of open orders that already close a spread (``*_to_close`` intents).

    A triggered exit whose spread already has a resting closing order must not submit a
    second one — day-only TIF means an unfilled close dies at the bell and re-arms next
    cycle, but within the session duplicate exits would stack against the same position.
    Entry orders resting on the same strikes carry ``*_to_open`` intents and never match.
    """
    sets: set[frozenset[str]] = set()
    for order in open_orders or []:
        legs = getattr(order, "legs", None) or []
        symbols = {str(leg.symbol) for leg in legs if getattr(leg, "symbol", None)}
        if not symbols:
            continue
        intents = {str(getattr(leg, "position_intent", "") or "") for leg in legs}
        if any("to_close" in intent for intent in intents):
            sets.add(frozenset(symbols))
    return sets


def _prepare_closings(
    triggered: list[ExitEvaluation],
    *,
    working_leg_sets: set[frozenset[str]],
    strategy_config: dict[str, Any],
) -> tuple[list[dict[str, Any]], str]:
    """Turn triggered exits into the closing orders they may send — or, per spread, the
    fail-closed note that lands in the persisted summary instead of an order.

    Plans are *not* submitted here: the caller submits only after the decision row is
    persisted (no order ever goes out unlogged, constraint #5). A spread whose closing
    order is already resting is skipped, not duplicated."""
    slippage = strategy_config["exit"]["close_slippage_usd"]
    plans: list[dict[str, Any]] = []
    notes: list[str] = []
    for evaluation in triggered:
        spread = evaluation.spread
        leg_set = frozenset({spread.short_symbol, spread.long_symbol})
        if leg_set in working_leg_sets:
            notes.append(
                f" {spread.short_symbol}: a closing order is already working — not duplicated."
            )
            continue
        limit_price = closing_limit_price(evaluation.detail.get("mark_to_close"), slippage)
        if limit_price is None:
            notes.append(
                f" {spread.short_symbol}: no closing order — the close cannot be priced "
                "(no usable leg quotes), fail-closed; it re-arms next cycle."
            )
            continue
        request = build_closing_mleg_order(
            spread,
            spread.qty,
            limit_price,
            client_order_id=f"beleth-exit-{uuid.uuid4().hex}",
        )
        plans.append(
            {
                "request": request,
                "qty": spread.qty,
                "limit": abs(limit_price),
                "credit_to_close": limit_price < 0,
                "legs": describe_closing_legs(spread),
                "exit_reason": evaluation.rule,
                "spread": spread.as_dict(),
                "client_order_id": request.client_order_id,
            }
        )
        note = (
            f" One closing order for {spread.short_symbol} ({spread.qty} spread(s) at a "
            f"{abs(limit_price):.2f} {'net-credit' if limit_price < 0 else 'net-debit'} "
            "limit) is being sent; the trades log carries the outcome."
        )
        notes.append(note)
    return plans, ("".join(notes) if notes else "")


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

    # --- R5: open legs paired back into spreads, measured against the exit rules ---------
    # Exits are mechanical risk management, never LLM-gated: the pairing runs every cycle
    # and each spread's R5 verdict is persisted like any other check (constraint #3).
    # Anomalies — naked legs, unparseable positions — and spreads without a computable
    # entry credit block new entries: the gate must not add risk it cannot size.
    position_dumps = [p.model_dump(mode="json") for p in positions]
    open_spreads, position_anomalies = pair_open_spreads(position_dumps)

    leg_symbols = sorted(
        {sym for spread in open_spreads for sym in (spread.short_symbol, spread.long_symbol)}
    )
    leg_quotes: dict[str, tuple[float | None, float | None]] = {}
    if leg_symbols:
        try:
            leg_quotes = fetch_latest_quotes(option_client, leg_symbols)
        except Exception as exc:  # noqa: BLE001 — unquotable legs must not kill the cycle
            print(
                f"WARNING: quotes for open legs unavailable ({type(exc).__name__}: {exc}) "
                "— the P/L exit rules cannot fire this cycle (the ITM rule still can).",
                file=sys.stderr,
            )

    exit_cfg = strategy["exit"]
    exit_evaluations: list[ExitEvaluation] = []
    for spread in open_spreads:
        short_bid, short_ask = leg_quotes.get(spread.short_symbol, (None, None))
        long_bid, long_ask = leg_quotes.get(spread.long_symbol, (None, None))
        exit_evaluations.append(
            evaluate_exit(
                spread,
                short_bid=short_bid,
                short_ask=short_ask,
                long_bid=long_bid,
                long_ask=long_ask,
                underlying_last=last_price,
                profit_target_pct=exit_cfg["profit_target_pct_of_max_credit"],
                loss_multiple=exit_cfg["loss_close_credit_multiple"],
                exit_on_short_itm=exit_cfg["loss_close_on_short_leg_itm"],
            )
        )
    triggered_exits = [e for e in exit_evaluations if e.triggered]

    # The risk gate counts positions in spreads (the strategy's unit), not raw legs.
    open_position_count = len(open_spreads) + len(position_anomalies)
    entry_blocks = [str(a["reason"]) for a in position_anomalies]
    entry_blocks += [
        f"open spread {spread.short_symbol}/{spread.long_symbol} has no computable entry "
        "credit, so its risk cannot be sized"
        for spread in open_spreads
        if spread.entry_credit is None
    ]
    capital_at_risk = round(
        sum(
            spread.qty * spread.max_loss_per_spread
            for spread in open_spreads
            if spread.max_loss_per_spread is not None
        ),
        2,
    )

    equity = float(account.equity)
    last_equity = float(account.last_equity)
    day_pnl = equity - last_equity
    daily_stop = equity * strategy["risk"]["daily_drawdown_stop_pct"] / 100
    # Loss still absorbable today before the daily-drawdown stop trips (never negative).
    risk_budget_remaining_today = max(0.0, daily_stop + min(0.0, day_pnl))

    account_snapshot = AccountSnapshot(
        cash=float(account.cash),
        buying_power=float(account.buying_power),
        open_positions=open_position_count,
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
        open_positions_detail=[e.as_dict() for e in exit_evaluations],
        account=account_snapshot,
    )

    # --- risk gate over the candidates the evidence package actually carries -------------
    risk_state = AccountRiskState(
        equity=equity,
        open_positions=open_position_count,
        day_pnl=round(day_pnl, 2),
        capital_at_risk=capital_at_risk,  # paired open spreads' known max loss (R5)
    )
    verdicts = evaluate_candidates(candidates, risk_state, strategy)
    # Anomalies and unsizable open spreads reject every new entry (an extra R6 row) —
    # surfaced in the same risk_checks rows as every other rule, never silent.
    verdicts = block_entries(verdicts, entry_blocks)

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

    # --- exit path: a triggered close may itself become the cycle's order -----------------
    # Closings are prepared only while the market is open, and only after listing the open
    # orders that may already be working the same exit; if open orders cannot be listed the
    # close is not sent this cycle (fail-closed against duplicates) and re-arms next cycle.
    exit_plans: list[dict[str, Any]] = []
    exit_plan_notes = ""
    if triggered_exits and clock.is_open:
        try:
            open_orders = trading.get_orders(
                GetOrdersRequest(status=QueryOrderStatus.OPEN, nested=True)
            )
        except Exception as exc:  # noqa: BLE001 — a data failure must not cause duplicate exits
            print(
                f"WARNING: cannot list open orders ({type(exc).__name__}: {exc}) — closings "
                "are not sent this cycle (fail-closed); they re-arm next cycle.",
                file=sys.stderr,
            )
        else:
            exit_plans, exit_plan_notes = _prepare_closings(
                triggered_exits,
                working_leg_sets=working_exit_leg_sets(open_orders),
                strategy_config=strategy,
            )

    # --- order path: only a 'trade' decision may become an order, and only through the gate
    # The order is prepared (sized, priced, built) here but submitted only after the
    # decision row is persisted — no order ever goes out unlogged (constraint #5).
    plan: dict[str, Any] | None = None
    if draft.action == "trade" and draft.chosen_candidate is not None:
        plan, order_note = _prepare_order(
            draft.chosen_candidate, candidates, equity=equity, strategy_config=strategy
        )
        draft = replace(draft, summary=draft.summary + order_note)

    exit_sentences = exit_summary_sentences(exit_evaluations, market_open=clock.is_open)
    if exit_sentences or exit_plan_notes:
        # Open positions come first in the persisted summary: managing them outranks entries.
        draft = replace(draft, summary=exit_sentences + exit_plan_notes + draft.summary)
    if exit_plans:
        # Closing an open spread is itself a trade the dashboard must show as such —
        # an exit-only cycle is action='trade' with no chosen entry candidate.
        draft = replace(draft, action="trade")

    # --- persistence: every decision, risk-check outcome and position state (constraint #5) --
    decision_id = None
    persisted_checks = 0
    persisted_exit_checks = 0
    upserted_positions = 0
    submitted_order: dict[str, Any] | None = None
    order_failure: str | None = None
    submitted_exits = 0
    failed_exits = 0
    exit_outcomes: list[dict[str, Any]] = []
    try:
        supabase = supabase_config_from_settings(settings)
    except PersistenceConfigError as exc:
        print(
            f"WARNING: Supabase not configured — decision not persisted ({exc})",
            file=sys.stderr,
        )
        if plan is not None or exit_plans:
            # The decision could not be logged, so no order may go out either.
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
            # Each open spread's R5 verdict is a persisted check row like any other: for a
            # triggered close it IS the pre-trade check of the closing order (constraint #3).
            persisted_exit_checks = persist_exit_checks(
                supabase, decision_id=decision_id, evaluations=exit_evaluations
            )
            upserted_positions, _ = mirror_positions(
                supabase, [p.model_dump(mode="json") for p in positions]
            )

            # Exits first: closing a spread is risk reduction and does not queue behind a
            # new entry. A failed close is persisted as a first-class trades row; while the
            # position still exists the rule stays triggered, so the next cycle re-arms it.
            for exit_plan in exit_plans:
                exit_order: dict[str, Any] | None = None
                exit_failure: str | None = None
                try:
                    exit_order = submit_mleg_order(trading, exit_plan["request"])
                    submitted_exits += 1
                except OrderSubmissionError as exc:
                    exit_failure = str(exc)
                    failed_exits += 1
                    print(f"ERROR: exit order submission failed: {exit_failure}", file=sys.stderr)
                persist_trade(
                    supabase,
                    trade_row(
                        decision_id=decision_id,
                        underlying=symbol,
                        qty=exit_plan["qty"],
                        credit=None,
                        max_loss=None,
                        legs=exit_plan["legs"],
                        order=exit_order,
                        failure=exit_failure,
                        kind="exit",
                        exit_reason=exit_plan["exit_reason"],
                    ),
                )
                exit_outcomes.append(
                    {
                        "short_symbol": exit_plan["spread"]["short_symbol"],
                        "exit_reason": exit_plan["exit_reason"],
                        "status": (exit_order or {}).get("status") or "submission_failed",
                        "alpaca_order_id": (exit_order or {}).get("id"),
                        "qty": exit_plan["qty"],
                        "error": exit_failure,
                    }
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
                if submitted_order is not None or submitted_exits > 0
                else ("monitoring" if clock.is_open else "idle")
            )
            status_detail: dict[str, Any] = {
                "candidates": len(candidates),
                "risk_checks": persisted_checks,
                "approved": sum(1 for v in verdicts if v.approved),
                "decision_source": draft.decision_source,
                "exits": {
                    "open_spreads": len(open_spreads),
                    "triggered": len(triggered_exits),
                    "submitted": submitted_exits,
                    "failed": failed_exits,
                    "anomalies": len(position_anomalies),
                },
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
            if exit_outcomes:
                status_detail["closings"] = exit_outcomes
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
    print("\n--- exits (R5) ---", file=sys.stderr)
    for anomaly in position_anomalies:
        print(
            f"ANOMALY: {anomaly['reason']} — {anomaly['position'].get('symbol')} "
            f"x{anomaly['position'].get('qty')} (new entries are blocked until resolved)",
            file=sys.stderr,
        )
    if not exit_evaluations and not position_anomalies:
        print("No open positions — nothing to manage.", file=sys.stderr)
    for evaluation in exit_evaluations:
        print(f"{'EXIT' if evaluation.triggered else 'hold'}: {evaluation.reason}", file=sys.stderr)
    for outcome in exit_outcomes:
        if outcome.get("error"):
            print(
                f"closing {outcome['short_symbol']}: SUBMISSION FAILED — {outcome['error']}",
                file=sys.stderr,
            )
        else:
            print(
                f"closing {outcome['short_symbol']}: id={outcome['alpaca_order_id']} "
                f"status={outcome['status']} qty={outcome['qty']}",
                file=sys.stderr,
            )

    if decision_id is not None:
        print(
            f"\nDecision {decision_id} persisted to Supabase "
            f"({persisted_checks} entry check(s), {persisted_exit_checks} exit check(s), "
            f"{upserted_positions} position(s) mirrored).",
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
