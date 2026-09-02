"""One cycle, start to finish.

The stages in order, with the two contracts that matter stated where they are enforced:
the evidence package goes to **stdout** and the operator's narrative to **stderr**, and
the decision is persisted before any order is sent.

`scripts/check_market_data.py` is a thin CLI over this. That path, its argv and its exit
codes are referenced by `scripts/run_agent.py`, the container's `CMD`, the README and
the published documentation, so the script stays exactly where it is.
"""

from __future__ import annotations

import json

from app.cycle.account import gather_account_state
from app.cycle.config import build_clients, load_cycle_config
from app.cycle.decide import decide
from app.cycle.execute import execute_and_persist
from app.cycle.gates import build_package, evaluate_gates
from app.cycle.gather import gather_market_evidence
from app.cycle.planning import plan_orders
from app.cycle.report import report


def run_cycle(argv: list[str]) -> int:
    """Exit code for one cycle: 0 when it completed, 1 when it could not be logged.

    A cycle that decides not to trade is a success. The only failure is a cycle whose
    decision could not be persisted — persisting is part of the contract, not a
    side effect — and a configuration error before anything started.
    """
    loaded = load_cycle_config(argv)
    if loaded is None:
        return 1
    settings, cfg = loaded
    clients = build_clients(settings)

    market = gather_market_evidence(clients, cfg)
    state = gather_account_state(clients, cfg)

    package = build_package(cfg, market, state)
    gates = evaluate_gates(cfg, market, state)
    draft = decide(cfg, state, gates, package, settings)
    plans, draft = plan_orders(cfg, market, state, gates, draft)

    outcome = execute_and_persist(cfg, clients, market, state, gates, plans, draft, settings)

    # stdout is the machine-readable record, whatever happened. It is printed before the
    # narrative so a caller that pipes stdout gets the package even on a failed cycle.
    print(json.dumps(package, indent=2, default=str))
    if outcome.persistence_failed:
        return 1

    report(cfg, market, state, gates, plans, draft, outcome)
    return 0
