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
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


from app.cycle.account import gather_account_state
from app.cycle.config import build_clients, load_cycle_config
from app.cycle.decide import decide
from app.cycle.execute import execute_and_persist
from app.cycle.gates import build_package, evaluate_gates
from app.cycle.gather import gather_market_evidence
from app.cycle.planning import plan_orders
from app.vrp import best_tradable_tenor


def main() -> int:
    loaded = load_cycle_config(sys.argv)
    if loaded is None:
        return 1
    settings, cfg = loaded
    strategy = cfg.strategy
    clients = build_clients(settings)

    market = gather_market_evidence(clients, cfg)
    tenor_vrp = market.tenor_vrp
    blocked_dtes = market.blocked_dtes

    state = gather_account_state(clients, cfg)
    position_anomalies = state.position_anomalies
    exit_evaluations = state.exit_evaluations

    package = build_package(cfg, market, state)
    gates = evaluate_gates(cfg, market, state)
    verdicts = gates.verdicts

    draft = decide(cfg, state, gates, package, settings)

    plans, draft = plan_orders(cfg, market, state, gates, draft)
    plan = plans.entry

    outcome = execute_and_persist(cfg, clients, market, state, gates, plans, draft, settings)
    decision_id = outcome.decision_id
    persisted_checks = outcome.persisted_checks
    persisted_exit_checks = outcome.persisted_exit_checks
    upserted_positions = outcome.upserted_positions
    submitted_order = outcome.submitted_order
    order_failure = outcome.order_failure
    exit_outcomes = outcome.exit_outcomes
    if outcome.persistence_failed:
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
    for closing in exit_outcomes:
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
