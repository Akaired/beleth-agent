"""The operator's narrative — what the cycle saw, refused and did.

Everything here goes to **stderr**, and the evidence package goes to stdout. That split
is the interface: `scripts/run_agent.py` and the container's logs read the narrative,
while a caller that wants the machine-readable record pipes stdout. Moving a line from
one stream to the other looks like tidying and breaks both.

The order is deliberate too. The refusals come before the decision, because a cycle
that did nothing has to say what stopped it, and an operator reading a quiet log needs
that answer first.
"""

from __future__ import annotations

import sys

from app.cycle.context import (
    AccountState,
    CycleConfig,
    ExecutionOutcome,
    GateOutcome,
    MarketEvidence,
    OrderPlans,
)
from app.decision import DecisionDraft
from app.vrp import best_tradable_tenor


def report(
    cfg: CycleConfig,
    market: MarketEvidence,
    state: AccountState,
    gates: GateOutcome,
    plans: OrderPlans,
    draft: DecisionDraft,
    outcome: ExecutionOutcome,
) -> None:
    best = best_tradable_tenor(market.tenor_vrp)
    print("\n--- summary ---", file=sys.stderr)
    if best is None:
        print(
            "No tenor clears the VRP threshold "
            f"({cfg.strategy['tenor_scan']['vrp_threshold_vol_points']} vol points) "
            "— agent would NOT trade.",
            file=sys.stderr,
        )
    else:
        blocked_note = " (calendar-blocked)" if best.dte in market.blocked_dtes else ""
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
    if not gates.verdicts:
        print(
            "No candidate reached the risk gate (see the no-trade reason above).", file=sys.stderr
        )
    for v in gates.verdicts:
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
    for anomaly in state.position_anomalies:
        print(
            f"ANOMALY: {anomaly['reason']} — {anomaly['position'].get('symbol')} "
            f"x{anomaly['position'].get('qty')} (new entries are blocked until resolved)",
            file=sys.stderr,
        )
    if not state.exit_evaluations and not state.position_anomalies:
        print("No open positions — nothing to manage.", file=sys.stderr)
    for evaluation in state.exit_evaluations:
        print(f"{'EXIT' if evaluation.triggered else 'hold'}: {evaluation.reason}", file=sys.stderr)
    for closing in outcome.exit_outcomes:
        if closing.get("error"):
            print(
                f"closing {closing['short_symbol']}: SUBMISSION FAILED — {closing['error']}",
                file=sys.stderr,
            )
        else:
            print(
                f"closing {closing['short_symbol']}: id={closing['alpaca_order_id']} "
                f"status={closing['status']} qty={closing['qty']}",
                file=sys.stderr,
            )

    if outcome.decision_id is not None:
        print(
            f"\nDecision {outcome.decision_id} persisted to Supabase "
            f"({outcome.persisted_checks} entry check(s), "
            f"{outcome.persisted_exit_checks} exit check(s), "
            f"{outcome.upserted_positions} position(s) mirrored).",
            file=sys.stderr,
        )

    print("\n--- decision ---", file=sys.stderr)
    print(f"source={draft.decision_source} action={draft.action}", file=sys.stderr)
    print(draft.summary, file=sys.stderr)
    if outcome.submitted_order is not None and plans.entry is not None:
        print(
            f"order: id={outcome.submitted_order.get('id')} "
            f"client_order_id={plans.entry['client_order_id']} "
            f"status={outcome.submitted_order.get('status')} qty={plans.entry['qty']} "
            f"limit={plans.entry['credit']} net credit",
            file=sys.stderr,
        )
    elif outcome.order_failure is not None:
        print(f"order: SUBMISSION FAILED — {outcome.order_failure}", file=sys.stderr)
    if draft.llm_usage is not None:
        usage = draft.llm_usage
        print(
            f"llm tokens: {usage.get('prompt_tokens', 0)} prompt / "
            f"{usage.get('completion_tokens', 0)} completion / "
            f"{usage.get('total_tokens', 0)} total ({draft.llm_model})",
            file=sys.stderr,
        )
