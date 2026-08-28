"""The decision a cycle persists — the deterministic verdict while the LLM layer is absent.

The action is always ``no_trade`` with ``decision_source='risk_engine'``: there is no LLM to
choose a structure and no order path to send one to, so claiming anything else would be a
lie in the persisted record. The summary is the plain-language verdict the anonymous
homepage renders, so it must stand alone and stay honest (constraint #10): it
always discloses that the LLM decision layer is not wired yet.

The LLM decision milestone will add a ``decide_from_llm`` alongside this one (same
``DecisionDraft``, ``decision_source='llm'``, filled ``llm_*`` columns); nothing else in the
persistence path needs to change.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.risk_check import RiskVerdict

HONESTY_SUFFIX = (
    " Decided by the deterministic risk engine — the LLM decision layer is not wired yet."
)


@dataclass(frozen=True)
class DecisionDraft:
    """Everything a cycle persists as its decision. Pure data — IO happens in the caller.

    ``llm_*`` stay ``None`` until the LLM decision layer milestone fills them.
    """

    as_of: datetime
    symbol: str
    action: str  # always "no_trade" while decision_source is "risk_engine"
    decision_source: str  # "risk_engine" today; "llm" once the LLM milestone lands
    summary: str
    market_open: bool
    equity: float
    day_pnl: float
    evidence: dict[str, Any]
    strategy_config: dict[str, Any]
    llm_model: str | None = None
    llm_reasoning: str | None = None
    llm_usage: dict[str, Any] | None = None


def decide_from_risk_engine(
    *,
    as_of: datetime,
    symbol: str,
    market_open: bool,
    equity: float,
    day_pnl: float,
    evidence: dict[str, Any],
    strategy_config: dict[str, Any],
    verdicts: Sequence[RiskVerdict],
) -> DecisionDraft:
    """Deterministic verdict for one cycle: no candidates -> say why; candidates -> report
    what the risk gate did with them. Every summary ends with the honesty clause."""
    if not market_open:
        headline = "No trade: the market is closed."
    elif not verdicts:
        headline = _no_candidate_summary(
            evidence=evidence, strategy_config=strategy_config
        )
    else:
        headline = _verdict_summary(verdicts)
    return DecisionDraft(
        as_of=as_of,
        symbol=symbol,
        action="no_trade",
        decision_source="risk_engine",
        summary=headline + HONESTY_SUFFIX,
        market_open=market_open,
        equity=equity,
        day_pnl=day_pnl,
        evidence=evidence,
        strategy_config=strategy_config,
    )


def _no_candidate_summary(
    *, evidence: dict[str, Any], strategy_config: dict[str, Any]
) -> str:
    """Why nothing even reached the risk gate. Priority: macro calendar > VRP threshold."""
    blocks = evidence.get("calendar", {}).get("blocks_detail") or []
    if blocks:
        described = ", ".join(
            f"{b.get('dte')} DTE ({b.get('event')})" for b in blocks
        )
        return f"No trade: macro calendar blocks every candidate tenor — {described}."

    per_tenor = evidence.get("vrp", {}).get("per_tenor") or []
    if not per_tenor:
        return "No trade: no tenor VRP measurements available."
    measured = [t for t in per_tenor if t.get("vrp_vs_rv20") is not None]
    if not measured:
        return (
            "No trade: no realized-vol baseline (RV20 unavailable) to measure the "
            "volatility risk premium against."
        )
    threshold = strategy_config.get("tenor_scan", {}).get(
        "vrp_threshold_vol_points", "configured"
    )
    best = max(measured, key=lambda t: t["vrp_vs_rv20"])
    return (
        f"No trade: best VRP was {best['vrp_vs_rv20']:.2f} vol points ({best['dte']} DTE), "
        f"below the {threshold} vol-point threshold — no tenor qualifies."
    )


def _verdict_summary(verdicts: Sequence[RiskVerdict]) -> str:
    approved = [v for v in verdicts if v.approved]
    if not approved:
        rejected_by = sorted({r.rule for v in verdicts for r in v.rejections})
        return (
            f"No trade: {len(verdicts)} candidate(s) built, all rejected by the risk gate "
            f"({', '.join(rejected_by)})."
        )
    losses = [v.max_loss for v in approved if v.max_loss is not None]
    smallest = min(losses) if losses else 0.0
    return (
        f"No trade: {len(approved)} of {len(verdicts)} candidate(s) passed the risk gate "
        f"(smallest max loss ${smallest:,.2f}) but no order path is wired yet."
    )