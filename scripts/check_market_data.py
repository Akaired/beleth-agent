#!/usr/bin/env python3
"""Run one full agent cycle: evidence, R5 exits, risk gate, decision, orders.

Builds the evidence package, pairs the account's open option legs
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
— rejections are first-class. Open anomalies (naked legs,
unparseable positions) and spreads without a computable entry credit reject every new
entry through the gate until resolved.

A ``trade`` decision becomes exactly one multi-leg ``mleg`` limit order on the Alpaca paper
account, submitted only after the decision row is persisted: the structure is the chosen
candidate's own two legs (short sell-to-open, long buy-to-open — covered inside the order,
never split), the quantity is sized by ``risk.max_risk_per_trade_pct_of_equity``, and the
limit demands the measured credit minus the configured slippage. Sizing or pricing that
cannot respect the cap fails closed with the reason in the persisted summary; a submission
failure is persisted as a trades row with status 'submission_failed' — rejections are
first-class. Either way the cycle persists the decision
(full evidence package), one risk_checks row per (candidate, rule) plus one per open
spread's R5 verdict, the trades rows when orders were attempted, the open-positions
mirror, and the agent_status heartbeat.

Persistence is skipped with a stderr warning when Supabase is not configured (read-only
usage keeps working — and then no order is sent either, because an order must never go out
unlogged); a persistence *failure* prints the evidence and exits 1 — persisting the
decision is part of the cycle's contract.

Usage:
    python3 scripts/check_market_data.py [SYMBOL]
"""

from __future__ import annotations

import json
import sys
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


from app.cycle.account import gather_account_state
from app.cycle.config import build_clients, load_cycle_config
from app.cycle.gather import gather_market_evidence
from app.cycle.open_orders import (
    working_exit_orders,
)
from app.cycle.planning import _prepare_closings, _prepare_order
from app.decision import decide_from_llm, decide_from_risk_engine
from app.eventlog import EventLog
from app.evidence import build_evidence_package
from app.exits import (
    exit_summary_sentences,
)
from app.orders import (
    OrderSubmissionError,
    submit_mleg_order,
)
from app.persistence import (
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
from app.redact import describe_exception
from app.risk_check import (
    AccountRiskState,
    apply_aggregate_cap,
    apply_vix_regime,
    block_entries,
    evaluate_candidates,
    vix_size_multiplier,
)
from app.vrp import best_tradable_tenor


def main() -> int:
    loaded = load_cycle_config(sys.argv)
    if loaded is None:
        return 1
    settings, cfg = loaded
    symbol = cfg.symbol
    strategy = cfg.strategy
    clients = build_clients(settings)
    trading = clients.trading

    market = gather_market_evidence(clients, cfg)
    last_price = market.underlying_last
    realized_vols = market.realized_vols
    vix_regime = market.vix_regime
    vix_error = market.vix_error
    term_structure = market.term_structure
    tenor_vrp = market.tenor_vrp
    next_event = market.next_event
    blocks = market.blocked_tenors
    blocked_dtes = market.blocked_dtes
    candidates = market.candidates
    now_et = cfg.now_et

    state = gather_account_state(clients, cfg)
    clock_is_open = state.market_open
    positions = state.positions
    open_spreads = state.open_spreads
    position_anomalies = state.position_anomalies
    exit_evaluations = state.exit_evaluations
    triggered_exits = state.triggered_exits
    open_orders = state.open_orders
    open_orders_error = state.open_orders_error
    open_position_count = state.open_position_count
    equity = state.equity
    day_pnl = state.day_pnl
    account_snapshot = state.snapshot
    risk_state = state.risk_state
    capital_at_risk = state.capital_at_risk
    entry_blocks = state.entry_blocks

    package = build_evidence_package(
        as_of=datetime.now(UTC),
        market_open=clock_is_open,
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
    # Account-level aggregate cap (R11): committed risk across open positions plus this
    # candidate's max loss must stay within the configured percent of equity. Inert
    # (cap 0) until a value is set in config/strategy.yaml.
    verdicts = apply_aggregate_cap(
        verdicts,
        risk_state,
        max_aggregate_risk_pct=strategy["risk"].get("max_aggregate_risk_pct_of_equity", 0),
    )
    # R9 — VIX-regime size taper. Reads the VIX's own 1y percentile: a partial taper
    # (0 < m < 1) scales the per-trade risk budget in `_prepare_order`; a hard block
    # (m == 0) rejects every still-approved candidate with a visible R9 row. Inert until
    # the thresholds are set in config/strategy.yaml `entry.vix_regime`.
    vix_regime_cfg = strategy.get("entry", {}).get("vix_regime", {})
    vix_percentile = vix_regime.percentile_1y if vix_regime is not None else None
    vix_size_mult, vix_size_reason = vix_size_multiplier(
        vix_percentile,
        taper_upper_pct=vix_regime_cfg.get("taper_upper_pct", 0),
        taper_lower_pct=vix_regime_cfg.get("taper_lower_pct", 0),
        taper_floor_frac=vix_regime_cfg.get("taper_floor_frac", 1.0),
        block_below_pct=vix_regime_cfg.get("block_below_pct", 0),
    )
    verdicts = apply_vix_regime(verdicts, vix_size_mult, vix_size_reason)

    # --- decision: the LLM weighs the evidence only when it has something to weigh ------
    as_of = datetime.now(UTC)
    if clock_is_open and any(v.approved for v in verdicts):
        draft = decide_from_llm(
            as_of=as_of,
            symbol=symbol,
            market_open=clock_is_open,
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
            market_open=clock_is_open,
            equity=round(equity, 2),
            day_pnl=round(day_pnl, 2),
            evidence=package,
            strategy_config=strategy,
            verdicts=verdicts,
        )

    # --- exit path: a triggered close may itself become the cycle's order -----------------
    # Closings are prepared only while the market is open, and only against the open
    # orders listed earlier this cycle; if that listing failed the close is not sent
    # (fail-closed against duplicates) and re-arms next cycle.
    exit_plans: list[dict[str, Any]] = []
    exit_plan_notes = ""
    if triggered_exits and clock_is_open:
        if open_orders_error:
            print(
                "WARNING: open orders unavailable — closings are not sent this cycle "
                "(fail-closed); they re-arm next cycle.",
                file=sys.stderr,
            )
        else:
            exit_plans, exit_plan_notes = _prepare_closings(
                triggered_exits,
                working_exits=working_exit_orders(open_orders),
                strategy_config=strategy,
            )

    # --- order path: only a 'trade' decision may become an order, and only through the gate
    # The order is prepared (sized, priced, built) here but submitted only after the
    # decision row is persisted — no order ever goes out unlogged.
    plan: dict[str, Any] | None = None
    if draft.action == "trade" and draft.chosen_candidate is not None:
        plan, order_note = _prepare_order(
            draft.chosen_candidate,
            candidates,
            equity=equity,
            strategy_config=strategy,
            risk_pct_multiplier=vix_size_mult,
        )
        draft = replace(draft, summary=draft.summary + order_note)
    # When R9 tapered the size down or hard-blocked, that is disclosed on the persisted
    # decision summary — a smaller trade or a "no" for a stated reason, never silent.
    if vix_size_mult != 1.0:
        draft = replace(draft, summary=draft.summary + " " + vix_size_reason)

    exit_sentences = exit_summary_sentences(exit_evaluations, market_open=clock_is_open)
    if exit_sentences or exit_plan_notes:
        # Open positions come first in the persisted summary: managing them outranks entries.
        draft = replace(draft, summary=exit_sentences + exit_plan_notes + draft.summary)
    if exit_plans:
        # Closing an open spread is itself a trade the dashboard must show as such —
        # an exit-only cycle is action='trade' with no chosen entry candidate.
        draft = replace(draft, action="trade")

    # --- persistence: every decision, risk-check outcome and position state --
    decision_id = None
    persisted_checks = 0
    persisted_exit_checks = 0
    upserted_positions = 0
    submitted_order: dict[str, Any] | None = None
    order_failure: str | None = None
    submitted_exits = 0
    failed_exits = 0
    exit_outcomes: list[dict[str, Any]] = []
    elog = EventLog()
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
            elog.emit(
                "info",
                "decision" if draft.action == "trade" else "no_trade",
                draft.summary[:280],
                symbol=symbol,
                action=draft.action,
                source=draft.decision_source,
            )
            persisted_checks = persist_risk_checks(
                supabase, decision_id=decision_id, verdicts=verdicts
            )
            approved_n = sum(1 for v in verdicts if v.approved)
            if candidates and approved_n < len(candidates):
                reject_reasons = sorted({r.rule for v in verdicts for r in v.rejections})
                elog.warn(
                    "risk_rejected",
                    f"{approved_n}/{len(candidates)} candidates cleared the risk gate "
                    f"(rejected by {', '.join(reject_reasons) or 'n/a'})",
                    symbol=symbol,
                    approved=approved_n,
                    candidates=len(candidates),
                    rules=reject_reasons,
                )
            if position_anomalies:
                elog.warn(
                    "position_anomaly",
                    f"{len(position_anomalies)} open leg(s) could not be paired into a spread",
                    symbol=symbol,
                    count=len(position_anomalies),
                )
            if triggered_exits:
                elog.warn(
                    "exit_triggered",
                    f"{len(triggered_exits)} open spread(s) hit an exit target: "
                    + "; ".join(e.reason for e in triggered_exits)[:240],
                    symbol=symbol,
                    count=len(triggered_exits),
                )
            # Each open spread's R5 verdict is a persisted check row like any other: for a
            # triggered close it IS the pre-trade check of the closing order.
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
                    replace_order_id = exit_plan.get("replace_order_id")
                    if replace_order_id is not None:
                        # Cancel the stale resting close first; if it will not cancel, do
                        # NOT send a second one — a duplicate close would stack against
                        # the same position. The rule stays triggered and re-arms.
                        try:
                            trading.cancel_order_by_id(replace_order_id)
                        except Exception as exc:
                            raise OrderSubmissionError(
                                f"could not cancel stale closing order {replace_order_id}: "
                                f"{describe_exception(exc)}"
                            ) from exc
                        elog.info(
                            "exit_repriced",
                            f"cancelled stale closing order {replace_order_id} for "
                            f"{exit_plan['spread']['short_symbol']} — resubmitting at "
                            f"{exit_plan['limit']:.2f}",
                            symbol=symbol,
                            exit_reason=exit_plan["exit_reason"],
                            alpaca_order_id=replace_order_id,
                        )
                    exit_order = submit_mleg_order(trading, exit_plan["request"])
                    submitted_exits += 1
                    elog.info(
                        "exit_submitted",
                        f"closing {exit_plan['spread']['short_symbol']} "
                        f"({exit_plan['exit_reason']}) — order {exit_order.get('id')}",
                        symbol=symbol,
                        exit_reason=exit_plan["exit_reason"],
                        alpaca_order_id=exit_order.get("id"),
                        qty=exit_plan["qty"],
                    )
                except OrderSubmissionError as exc:
                    exit_failure = str(exc)
                    failed_exits += 1
                    print(f"ERROR: exit order submission failed: {exit_failure}", file=sys.stderr)
                    elog.error(
                        "exit_failed",
                        f"closing order for {exit_plan['spread']['short_symbol']} "
                        f"rejected: {exit_failure}",
                        symbol=symbol,
                        exit_reason=exit_plan["exit_reason"],
                    )
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
                # (rejections are first-class).
                try:
                    submitted_order = submit_mleg_order(trading, plan["request"])
                    elog.info(
                        "order_submitted",
                        f"entry order {submitted_order.get('id')} — {plan['qty']}x, "
                        f"credit {plan['credit']}, max loss {plan['max_loss']}",
                        symbol=symbol,
                        alpaca_order_id=submitted_order.get("id"),
                        status=submitted_order.get("status"),
                        qty=plan["qty"],
                        credit=plan["credit"],
                        max_loss=plan["max_loss"],
                    )
                except OrderSubmissionError as exc:
                    order_failure = str(exc)
                    print(f"ERROR: order submission failed: {order_failure}", file=sys.stderr)
                    elog.error(
                        "order_failed",
                        f"entry order rejected: {order_failure}",
                        symbol=symbol,
                    )

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
                else ("monitoring" if clock_is_open else "idle")
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
                    last_cycle_at=datetime.now(UTC),
                    last_decision_id=decision_id,
                    detail=status_detail,
                ),
            )
            elog.flush(supabase, decision_id=decision_id)
        except PersistenceError as exc:
            print(
                f"ERROR: persistence failed — cycle not fully logged: {exc}",
                file=sys.stderr,
            )
            elog.error("error", f"cycle persistence failed: {exc}", symbol=symbol)
            elog.flush(supabase, decision_id=decision_id)
            print(json.dumps(package, indent=2, default=str))
            return 1

    print(json.dumps(package, indent=2, default=str))

    best = best_tradable_tenor(tenor_vrp)
    print("\n--- summary ---", file=sys.stderr)
    if best is None:
        print(
            "No tenor clears the VRP threshold "
            f"({strategy['tenor_scan']['vrp_threshold_vol_points']} vol points) "
            "— agent would NOT trade.",
            file=sys.stderr,
        )
    else:
        blocked_note = " (calendar-blocked)" if best.dte in blocked_dtes else ""
        print(
            f"Best tenor by VRP: {best.dte} DTE, "
            f"VRP {best.vrp_vs_rv20:.2f} vol points{blocked_note}.",
            file=sys.stderr,
        )
    if market.backwardation_block:
        print(
            "Term structure is BACKWARDATION — regime gate blocks new short premium.",
            file=sys.stderr,
        )

    print("\n--- risk gate ---", file=sys.stderr)
    if not verdicts:
        print(
            "No candidate reached the risk gate (see the no-trade reason above).", file=sys.stderr
        )
    for v in verdicts:
        c = v.candidate
        tag = (
            "APPROVED"
            if v.approved
            else "REJECTED (" + ", ".join(r.rule for r in v.rejections) + ")"
        )
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
