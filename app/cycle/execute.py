"""Persisting the cycle, then sending what it decided — in that order.

The ordering is the contract, and it is the reason this stage exists apart from
planning: **the decision row is written before any order leaves**. An order live at the
broker with no decision row is the one state this project must never produce, and the
sequence here is what prevents it. Supabase unconfigured therefore means no order at
all, however good the decision was.

Within the sending, exits go first. Closing a spread is risk reduction and must not
queue behind a new entry. A failed close is persisted as a first-class `trades` row and
the rule stays triggered, so the next cycle re-arms it; a close that needs to replace a
stale resting order cancels that order first and, if the cancel fails, sends nothing —
a duplicate close would stack against the same position.

Every failure is a row, never a swallowed exception: a rejected order is a `trades` row
with `status='submission_failed'`, and the reason travels with it. That is hard
constraint #3, applied to the order path.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime
from typing import Any

from app.cycle.context import (
    AccountState,
    Clients,
    CycleConfig,
    ExecutionOutcome,
    GateOutcome,
    MarketEvidence,
    OrderPlans,
)
from app.decision import DecisionDraft
from app.eventlog import EventLog
from app.orders import OrderSubmissionError, submit_mleg_order
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


def execute_and_persist(
    cfg: CycleConfig,
    clients: Clients,
    market: MarketEvidence,
    state: AccountState,
    gates: GateOutcome,
    plans: OrderPlans,
    draft: DecisionDraft,
    settings: Any,
) -> ExecutionOutcome:
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
        if plans.entry is not None or plans.exits:
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
                symbol=cfg.symbol,
                action=draft.action,
                source=draft.decision_source,
            )
            persisted_checks = persist_risk_checks(
                supabase, decision_id=decision_id, verdicts=gates.verdicts
            )
            approved_n = sum(1 for v in gates.verdicts if v.approved)
            if market.candidates and approved_n < len(market.candidates):
                reject_reasons = sorted({r.rule for v in gates.verdicts for r in v.rejections})
                elog.warn(
                    "risk_rejected",
                    f"{approved_n}/{len(market.candidates)} candidates cleared the risk gate "
                    f"(rejected by {', '.join(reject_reasons) or 'n/a'})",
                    symbol=cfg.symbol,
                    approved=approved_n,
                    candidates=len(market.candidates),
                    rules=reject_reasons,
                )
            if state.position_anomalies:
                elog.warn(
                    "position_anomaly",
                    f"{len(state.position_anomalies)} open leg(s) could not be paired into a spread",
                    symbol=cfg.symbol,
                    count=len(state.position_anomalies),
                )
            if state.triggered_exits:
                elog.warn(
                    "exit_triggered",
                    f"{len(state.triggered_exits)} open spread(s) hit an exit target: "
                    + "; ".join(e.reason for e in state.triggered_exits)[:240],
                    symbol=cfg.symbol,
                    count=len(state.triggered_exits),
                )
            # Each open spread's R5 verdict is a persisted check row like any other: for a
            # triggered close it IS the pre-trade check of the closing order.
            persisted_exit_checks = persist_exit_checks(
                supabase, decision_id=decision_id, evaluations=state.exit_evaluations
            )
            upserted_positions, _ = mirror_positions(
                supabase, [p.model_dump(mode="json") for p in state.positions]
            )

            # Exits first: closing a spread is risk reduction and does not queue behind a
            # new entry. A failed close is persisted as a first-class trades row; while the
            # position still exists the rule stays triggered, so the next cycle re-arms it.
            for exit_plan in plans.exits:
                exit_order: dict[str, Any] | None = None
                exit_failure: str | None = None
                try:
                    replace_order_id = exit_plan.get("replace_order_id")
                    if replace_order_id is not None:
                        # Cancel the stale resting close first; if it will not cancel, do
                        # NOT send a second one — a duplicate close would stack against
                        # the same position. The rule stays triggered and re-arms.
                        try:
                            clients.trading.cancel_order_by_id(replace_order_id)
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
                            symbol=cfg.symbol,
                            exit_reason=exit_plan["exit_reason"],
                            alpaca_order_id=replace_order_id,
                        )
                    exit_order = submit_mleg_order(clients.trading, exit_plan["request"])
                    submitted_exits += 1
                    elog.info(
                        "exit_submitted",
                        f"closing {exit_plan['spread']['short_symbol']} "
                        f"({exit_plan['exit_reason']}) — order {exit_order.get('id')}",
                        symbol=cfg.symbol,
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
                        symbol=cfg.symbol,
                        exit_reason=exit_plan["exit_reason"],
                    )
                persist_trade(
                    supabase,
                    trade_row(
                        decision_id=decision_id,
                        underlying=cfg.symbol,
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

            if plans.entry is not None:
                # The decision is persisted; the prepared order may now go out. A
                # submission failure is persisted as a trades row, not swallowed
                # (rejections are first-class).
                try:
                    submitted_order = submit_mleg_order(clients.trading, plans.entry["request"])
                    elog.info(
                        "order_submitted",
                        f"entry order {submitted_order.get('id')} — {plans.entry['qty']}x, "
                        f"credit {plans.entry['credit']}, max loss {plans.entry['max_loss']}",
                        symbol=cfg.symbol,
                        alpaca_order_id=submitted_order.get("id"),
                        status=submitted_order.get("status"),
                        qty=plans.entry["qty"],
                        credit=plans.entry["credit"],
                        max_loss=plans.entry["max_loss"],
                    )
                except OrderSubmissionError as exc:
                    order_failure = str(exc)
                    print(f"ERROR: order submission failed: {order_failure}", file=sys.stderr)
                    elog.error(
                        "order_failed",
                        f"entry order rejected: {order_failure}",
                        symbol=cfg.symbol,
                    )

                persist_trade(
                    supabase,
                    trade_row(
                        decision_id=decision_id,
                        underlying=cfg.symbol,
                        qty=plans.entry["qty"],
                        credit=plans.entry["credit"],
                        max_loss=plans.entry["max_loss"],
                        legs=plans.entry["legs"],
                        order=submitted_order,
                        failure=order_failure,
                    ),
                )

            status_state = (
                "trade_executed"
                if submitted_order is not None or submitted_exits > 0
                else ("monitoring" if state.market_open else "idle")
            )
            status_detail: dict[str, Any] = {
                "candidates": len(market.candidates),
                "risk_checks": persisted_checks,
                "approved": sum(1 for v in gates.verdicts if v.approved),
                "decision_source": draft.decision_source,
                "exits": {
                    "open_spreads": len(state.open_spreads),
                    "triggered": len(state.triggered_exits),
                    "submitted": submitted_exits,
                    "failed": failed_exits,
                    "anomalies": len(state.position_anomalies),
                },
            }
            if plans.entry is not None:
                status_detail["order"] = (
                    {
                        "status": submitted_order.get("status"),
                        "alpaca_order_id": submitted_order.get("id"),
                        "qty": plans.entry["qty"],
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
            elog.error("error", f"cycle persistence failed: {exc}", symbol=cfg.symbol)
            elog.flush(supabase, decision_id=decision_id)
            return ExecutionOutcome(
                decision_id=decision_id,
                persisted_checks=persisted_checks,
                persisted_exit_checks=persisted_exit_checks,
                upserted_positions=upserted_positions,
                submitted_order=submitted_order,
                order_failure=order_failure,
                submitted_exits=submitted_exits,
                failed_exits=failed_exits,
                exit_outcomes=exit_outcomes,
                persistence_failed=True,
            )

    return ExecutionOutcome(
        decision_id=decision_id,
        persisted_checks=persisted_checks,
        persisted_exit_checks=persisted_exit_checks,
        upserted_positions=upserted_positions,
        submitted_order=submitted_order,
        order_failure=order_failure,
        submitted_exits=submitted_exits,
        failed_exits=failed_exits,
        exit_outcomes=exit_outcomes,
    )
