"""Who decides, and when the LLM is allowed to be asked.

The condition is narrow on purpose: the market must be open *and* at least one candidate
must have survived the risk gate. Anything else is decided by the deterministic risk
engine, which can only ever produce a no-trade. So an absent, slow, rate-limited or
misbehaving model cannot cause a trade — it can only fail to prevent one, and the gate
has already done the preventing.

The model also never sees a candidate the gate rejected: `decide_from_llm` is handed the
verdicts and filters to the approved ones itself.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.cycle.context import AccountState, CycleConfig, GateOutcome
from app.decision import DecisionDraft, decide_from_llm, decide_from_risk_engine


def decide(
    cfg: CycleConfig,
    state: AccountState,
    gates: GateOutcome,
    package: dict[str, Any],
    settings: Any,
) -> DecisionDraft:
    as_of = datetime.now(UTC)
    equity = round(state.equity, 2)
    day_pnl = round(state.day_pnl, 2)

    if state.market_open and any(v.approved for v in gates.verdicts):
        return decide_from_llm(
            as_of=as_of,
            symbol=cfg.symbol,
            market_open=state.market_open,
            equity=equity,
            day_pnl=day_pnl,
            evidence=package,
            strategy_config=cfg.strategy,
            verdicts=gates.verdicts,
            settings=settings,
        )
    return decide_from_risk_engine(
        as_of=as_of,
        symbol=cfg.symbol,
        market_open=state.market_open,
        equity=equity,
        day_pnl=day_pnl,
        evidence=package,
        strategy_config=cfg.strategy,
        verdicts=gates.verdicts,
    )
