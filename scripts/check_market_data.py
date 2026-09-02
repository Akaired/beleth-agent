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

The cycle itself lives in ``app/cycle/`` — one module per stage, with the types they
hand each other in ``app/cycle/context.py``. This file is the CLI over it, and stays at
this path because ``scripts/run_agent.py``, the container's ``CMD``, ``README.md`` and
the published documentation all name it.

Usage:
    python3 scripts/check_market_data.py [SYMBOL]
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.cycle.run import run_cycle


def main() -> int:
    return run_cycle(sys.argv)


if __name__ == "__main__":
    raise SystemExit(main())
