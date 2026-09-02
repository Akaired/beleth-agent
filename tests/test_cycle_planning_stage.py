"""`plan_orders` — the stage where the R9 multiplier can go missing.

`_prepare_order` defaults `risk_pct_multiplier` to 1.0. If `plan_orders` ever stops
passing `gates.vix_size_mult`, every position in a tapered regime is sized as though
there were no taper — twice the risk at a 0.5 taper — and nothing in the decision log
says so, because the taper's reason is appended by this same function. That is the most
expensive silent change available in the cycle, so it has a test of its own.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime

from app.config import load_strategy_config
from app.cycle.context import (
    AccountState,
    CycleConfig,
    GateOutcome,
    MarketEvidence,
)
from app.cycle.planning import plan_orders
from app.decision import DecisionDraft
from app.evidence import AccountSnapshot
from app.market.calendar import EASTERN
from app.market.term_structure import TermStructure
from app.options.spreads import build_candidates
from app.risk_check import AccountRiskState
from tests.cycle_fakes import put_credit_chain

TODAY = date.today()
DTE = 21


def _cfg() -> CycleConfig:
    return CycleConfig(
        symbol="SPY",
        strategy=load_strategy_config(),
        today_ordinal=TODAY.toordinal(),
        now_et=datetime.now(EASTERN),
    )


def _market(cfg: CycleConfig) -> MarketEvidence:
    chain = put_credit_chain(today=TODAY, dtes=[DTE])
    structure = cfg.strategy["structure"]
    candidates = build_candidates(
        chain,
        underlying="SPY",
        target_dtes=[DTE],
        today_ordinal=cfg.today_ordinal,
        delta_min=structure["short_leg_delta_min"],
        delta_max=structure["short_leg_delta_max"],
        width_min=structure["strike_width_usd_min"],
        width_max=structure["strike_width_usd_max"],
    )
    assert candidates, "the fake chain must yield a candidate for this test to mean anything"
    return MarketEvidence(
        underlying_last=450.0,
        realized_vols={},
        rv20=0.10,
        vix_regime=None,
        vix_error=None,
        chain=chain,
        term_structure=TermStructure(
            state="contango",
            short_atm_iv=0.20,
            long_atm_iv=0.22,
            short_dte=7,
            long_dte=45,
        ),
        tenor_vrp=[],
        next_event=None,
        blocked_tenors=[],
        blocked_dtes=set(),
        backwardation_block=False,
        candidates=candidates,
    )


def _state(*, market_open: bool = True, equity: float = 100_000.0) -> AccountState:
    return AccountState(
        equity=equity,
        day_pnl=0.0,
        capital_at_risk=0.0,
        open_position_count=0,
        market_open=market_open,
        positions=[],
        open_spreads=[],
        position_anomalies=[],
        exit_evaluations=[],
        triggered_exits=[],
        open_orders=[],
        open_orders_error="",
        entry_blocks=[],
        snapshot=AccountSnapshot(
            cash=equity,
            buying_power=equity * 2,
            open_positions=0,
            day_pnl=0.0,
            risk_budget_remaining_today=equity * 0.03,
        ),
        risk_state=AccountRiskState(
            equity=equity, open_positions=0, day_pnl=0.0, capital_at_risk=0.0
        ),
    )


def _trade_draft(cfg: CycleConfig, market: MarketEvidence) -> DecisionDraft:
    candidate = market.candidates[0]
    return DecisionDraft(
        as_of=datetime.now(),
        symbol="SPY",
        action="trade",
        decision_source="llm",
        summary="Trade.",
        market_open=True,
        equity=100_000.0,
        day_pnl=0.0,
        evidence={},
        strategy_config=cfg.strategy,
        chosen_candidate=candidate.as_dict(),
    )


def _plan_with_multiplier(mult: float):
    cfg = _cfg()
    market = _market(cfg)
    gates = GateOutcome(
        verdicts=[],
        vix_size_mult=mult,
        vix_size_reason=f"R9 (VIX taper): scaled to {mult:.0%} of the cap.",
    )
    plans, draft = plan_orders(cfg, market, _state(), gates, _trade_draft(cfg, market))
    return plans, draft


def test_the_r9_multiplier_actually_reaches_the_sizing():
    """Halve the multiplier, halve the quantity. If this passes at both values with the
    same qty, the multiplier is being dropped."""
    full, _ = _plan_with_multiplier(1.0)
    half, _ = _plan_with_multiplier(0.5)
    assert full.entry is not None and half.entry is not None
    assert half.entry["qty"] < full.entry["qty"]
    assert half.entry["qty"] == full.entry["qty"] // 2


def test_a_taper_is_disclosed_on_the_persisted_summary():
    """A smaller trade for an unstated reason is not acceptable — R9's sentence is
    appended whenever the multiplier is not neutral."""
    _, tapered = _plan_with_multiplier(0.5)
    assert "R9 (VIX taper)" in tapered.summary

    _, neutral = _plan_with_multiplier(1.0)
    assert "R9 (VIX taper)" not in neutral.summary


def test_a_no_trade_decision_produces_no_entry_plan():
    cfg = _cfg()
    market = _market(cfg)
    draft = replace(_trade_draft(cfg, market), action="no_trade", chosen_candidate=None)
    plans, out = plan_orders(cfg, market, _state(), GateOutcome([], 1.0, ""), draft)
    assert plans.entry is None
    assert plans.exits == []
    assert out.action == "no_trade"


def test_a_structure_the_cycle_never_built_is_refused_with_a_reason():
    """Fail-closed: a decision naming legs no candidate carries is a fault, not an
    order."""
    cfg = _cfg()
    market = _market(cfg)
    draft = _trade_draft(cfg, market)
    draft = replace(
        draft,
        chosen_candidate={**draft.chosen_candidate, "short_symbol": "SPY999999P00001000"},
    )
    plans, out = plan_orders(cfg, market, _state(), GateOutcome([], 1.0, ""), draft)
    assert plans.entry is None
    assert "No order was sent" in out.summary
