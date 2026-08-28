"""Unit tests for app/decision.py — the deterministic no-LLM verdict and its summary."""

from datetime import datetime, timezone

from app.decision import HONESTY_SUFFIX, decide_from_risk_engine
from app.risk_check import RuleResult, RiskVerdict


def _evidence(*, blocks=None, per_tenor=None):
    return {
        "as_of": "2026-08-28T14:00:00+00:00",
        "calendar": {"blocks_detail": blocks or []},
        "vrp": {"per_tenor": per_tenor or []},
    }


def _tenor(dte, vrp, passes):
    return {"dte": dte, "atm_iv": 0.18, "vrp_vs_rv20": vrp, "passes_threshold": passes}


_STRATEGY = {"tenor_scan": {"vrp_threshold_vol_points": 2.0}}


def _verdict(*, approved, rules):
    """rules: list of (rule_id, passed) pairs."""
    return RiskVerdict(
        approved=approved,
        max_loss=400.0 if approved else 900.0,
        breakeven=450.25,
        results=[
            RuleResult(rule, passed, f"{rule} reason", {})
            for rule, passed in rules
        ],
        candidate={"symbol": "SPY", "dte": 30},
    )


def _decide(**overrides):
    kwargs = {
        "as_of": datetime(2026, 8, 28, 14, 0, tzinfo=timezone.utc),
        "symbol": "SPY",
        "market_open": True,
        "equity": 100000.0,
        "day_pnl": 0.0,
        "evidence": _evidence(),
        "strategy_config": _STRATEGY,
        "verdicts": [],
    }
    kwargs.update(overrides)
    return decide_from_risk_engine(**kwargs)


def test_market_closed_heads_the_summary_even_with_verdicts():
    draft = _decide(
        market_open=False,
        evidence=_evidence(per_tenor=[_tenor(30, 4.6, True)]),
        verdicts=[_verdict(approved=True, rules=[("R4", True), ("R6", True), ("R7", True)])],
    )
    assert draft.summary.startswith("No trade: the market is closed.")


def test_calendar_block_reason_names_the_events():
    blocks = [{"dte": 7, "expiry": "2026-09-04", "event": "Nonfarm Payrolls"}]
    draft = _decide(evidence=_evidence(blocks=blocks))
    assert "Nonfarm Payrolls" in draft.summary
    assert "7 DTE" in draft.summary


def test_calendar_block_beats_vrp_reason():
    blocks = [{"dte": 7, "expiry": "2026-09-04", "event": "CPI"}]
    draft = _decide(
        evidence=_evidence(blocks=blocks, per_tenor=[_tenor(30, 4.6, True)]),
    )
    assert "macro calendar" in draft.summary
    assert "VRP" not in draft.summary


def test_vrp_reason_quotes_best_tenor_and_threshold():
    draft = _decide(
        evidence=_evidence(
            per_tenor=[_tenor(7, 1.6, False), _tenor(30, 1.9, False)]
        ),
    )
    assert "best VRP was 1.90 vol points (30 DTE)" in draft.summary
    assert "2.0 vol-point threshold" in draft.summary


def test_no_rv20_baseline_reason():
    draft = _decide(evidence=_evidence(per_tenor=[_tenor(30, None, False)]))
    assert "RV20 unavailable" in draft.summary


def test_all_rejected_names_the_rejecting_rules():
    verdicts = [
        _verdict(approved=False, rules=[("R4", True), ("R6", False), ("R7", True)]),
        _verdict(approved=False, rules=[("R4", True), ("R6", False), ("R7", False)]),
    ]
    draft = _decide(verdicts=verdicts)
    assert "2 candidate(s) built, all rejected by the risk gate (R6, R7)." in draft.summary


def test_approved_candidates_reported_but_no_order_path():
    verdicts = [
        _verdict(approved=False, rules=[("R4", True), ("R6", False), ("R7", True)]),
        _verdict(approved=True, rules=[("R4", True), ("R6", True), ("R7", True)]),
    ]
    draft = _decide(verdicts=verdicts)
    assert "1 of 2 candidate(s) passed the risk gate" in draft.summary
    assert "$400.00" in draft.summary
    assert "no order path is wired yet" in draft.summary


def test_summary_always_discloses_the_llm_gap():
    drafts = [
        _decide(market_open=False),
        _decide(evidence=_evidence(blocks=[{"dte": 7, "expiry": "x", "event": "CPI"}])),
        _decide(
            evidence=_evidence(per_tenor=[_tenor(30, 4.6, True)]),
            verdicts=[_verdict(approved=True, rules=[("R4", True), ("R6", True), ("R7", True)])],
        ),
    ]
    for draft in drafts:
        assert draft.summary.endswith(HONESTY_SUFFIX)
        assert draft.decision_source == "risk_engine"
        assert draft.action == "no_trade"


def test_draft_carries_evidence_and_strategy_config():
    evidence = _evidence(per_tenor=[_tenor(30, 4.6, True)])
    draft = _decide(evidence=evidence)
    assert draft.evidence is evidence
    assert draft.strategy_config is _STRATEGY
    assert draft.symbol == "SPY"
    assert draft.llm_model is None and draft.llm_usage is None