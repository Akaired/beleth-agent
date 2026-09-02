"""The evidence package, and the risk gate over it.

The gate runs in a fixed order and each layer is additive — none of them removes a
rejection an earlier one recorded, so a candidate refused by three rules shows all
three. Rejections are rows, not silence: that is hard constraint #3, and it is why every
block here produces a verdict rather than a `continue`.

* **R4 / R6 / R7** — per-candidate: defined risk, sizing, daily stop.
* **R10** — the account-level refusals `gather_account_state` collected: an unpaired
  leg, a spread whose risk cannot be sized, a resting entry order, an unreadable order
  book.
* **R11** — the aggregate cap: committed risk plus this candidate's max loss against a
  percentage of equity. Inert at a cap of 0.
* **R9** — the VIX taper. A partial taper is a *sizing* input and leaves the verdicts
  alone; a hard block rejects every still-approved candidate with its own visible row.

The multiplier R9 produces has to leave here with the verdicts, in `GateOutcome`.
`plan_orders` defaults it to 1.0, so a dropped multiplier doubles the position size in a
tapered regime and leaves nothing behind to show what happened.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.cycle.context import AccountState, CycleConfig, GateOutcome, MarketEvidence
from app.evidence import build_evidence_package
from app.risk_check import (
    apply_aggregate_cap,
    apply_vix_regime,
    block_entries,
    evaluate_candidates,
    vix_size_multiplier,
)


def build_package(cfg: CycleConfig, market: MarketEvidence, state: AccountState) -> dict[str, Any]:
    """The evidence package: everything the decision was made on, persisted verbatim.

    This is the artifact the dashboard reads and the judges check, so it is built from
    the same values the gate is about to use — never re-measured.
    """
    return build_evidence_package(
        as_of=datetime.now(UTC),
        market_open=state.market_open,
        underlying_symbol=cfg.symbol,
        underlying_last=market.underlying_last,
        realized_vols=market.realized_vols,
        vix_regime=market.vix_regime,
        vix_error=market.vix_error,
        term_structure=market.term_structure,
        tenor_vrp=market.tenor_vrp,
        next_event=market.next_event,
        blocked_tenors=market.blocked_tenors,
        now_et=cfg.now_et,
        candidates=market.candidates,
        open_positions_detail=[e.as_dict() for e in state.exit_evaluations],
        account=state.snapshot,
    )


def evaluate_gates(cfg: CycleConfig, market: MarketEvidence, state: AccountState) -> GateOutcome:
    strategy = cfg.strategy
    verdicts = evaluate_candidates(market.candidates, state.risk_state, strategy)
    verdicts = block_entries(verdicts, state.entry_blocks)
    verdicts = apply_aggregate_cap(
        verdicts,
        state.risk_state,
        max_aggregate_risk_pct=strategy["risk"].get("max_aggregate_risk_pct_of_equity", 0),
    )

    vix_regime_cfg = strategy.get("entry", {}).get("vix_regime", {})
    vix_percentile = market.vix_regime.percentile_1y if market.vix_regime is not None else None
    vix_size_mult, vix_size_reason = vix_size_multiplier(
        vix_percentile,
        taper_upper_pct=vix_regime_cfg.get("taper_upper_pct", 0),
        taper_lower_pct=vix_regime_cfg.get("taper_lower_pct", 0),
        taper_floor_frac=vix_regime_cfg.get("taper_floor_frac", 1.0),
        block_below_pct=vix_regime_cfg.get("block_below_pct", 0),
    )
    verdicts = apply_vix_regime(verdicts, vix_size_mult, vix_size_reason)

    return GateOutcome(
        verdicts=list(verdicts),
        vix_size_mult=vix_size_mult,
        vix_size_reason=vix_size_reason,
    )
