"""Integration test for the milestone-5 LLM decision layer: one real OpenRouter decision
over a synthetic-but-realistic evidence package.

Marked `integration` — run explicitly with:
    pytest -m integration

Free-model pools can 429 or stall; a cycle that falls back to the deterministic no-trade is
a legitimate outcome of this test, not a failure. What must never happen is a decision that
is neither a valid structured LLM choice nor the deterministic fallback.
"""

import json
from datetime import datetime, timezone

import pytest

from app.config import get_settings
from app.decision import decide_from_llm
from app.risk_check import RuleResult, RiskVerdict

pytestmark = pytest.mark.integration


def _approved_verdict() -> RiskVerdict:
    candidate = {
        "symbol": "SPY",
        "right": "P",
        "expiry": "2026-09-25",
        "dte": 28,
        "strikes": [640.0, 635.0],
        "strike_width": 5.0,
        "delta_short": -0.2,
        "credit": 0.85,
        "max_loss": 415.0,
        "breakeven": 639.15,
        "bid_ask_spread": 0.06,
    }
    return RiskVerdict(
        approved=True,
        max_loss=415.0,
        breakeven=639.15,
        results=[
            RuleResult(
                "R4",
                True,
                "R4 (defined risk only): max loss is defined and bounded at $415.00.",
                {"max_loss": 415.0},
            ),
            RuleResult(
                "R6",
                True,
                "R6 (sizing): candidate risk $415.00 is 0.42% of equity, within the "
                "2.00% cap; 0 of 5 position slots used.",
                {},
            ),
            RuleResult(
                "R7",
                True,
                "R7 (daily stop): today's drawdown $0.00 (0.00% of equity) is within the "
                "3.00% daily stop.",
                {},
            ),
        ],
        candidate=candidate,
    )


def _evidence() -> dict:
    return {
        "as_of": "2026-08-28T14:00:00+00:00",
        "market_open": True,
        "underlying": {
            "symbol": "SPY",
            "last": 769.01,
            "realized_vol": {"10d": 0.121, "20d": 0.116, "30d": 0.109},
        },
        "vix": {
            "level": 15.45,
            "as_of": "2026-08-27T00:00:00+00:00",
            "percentile_1y": 15.2,
            "rank_1y": 12.9,
            "lookback_points": 252,
            "term_structure": "flat",
            "short_atm_iv": 0.132,
            "long_atm_iv": 0.134,
            "term_structure_short_dte": 7,
            "term_structure_long_dte": 45,
        },
        "vrp": {
            "vix_minus_rv20": 3.85,
            "per_tenor": [
                {"dte": 28, "atm_iv": 0.133, "vrp_vs_rv20": 1.7, "passes_threshold": True}
            ],
        },
        "calendar": {
            "next_macro_event": {
                "name": "Nonfarm Payrolls",
                "datetime_et": "2026-09-04T08:30:00-04:00",
                "importance": "high",
                "days_away": 7.0,
            },
            "blocks_tenors": [],
            "blocks_detail": [],
        },
        "candidates": [],
        "account": {
            "cash": 100000.0,
            "buying_power": 400000.0,
            "open_positions": 0,
            "day_pnl": 0.0,
            "risk_budget_remaining_today": 3000.0,
        },
    }


def test_real_openrouter_cycle_produces_a_valid_decision():
    settings = get_settings()
    draft = decide_from_llm(
        as_of=datetime.now(timezone.utc),
        symbol="SPY",
        market_open=True,
        equity=100000.0,
        day_pnl=0.0,
        evidence=_evidence(),
        strategy_config={
            "tenor_scan": {"vrp_threshold_vol_points": 1.5},
            "regime": {"block_new_shorts_on_backwardation": True},
        },
        verdicts=[_approved_verdict()],
        settings=settings,
    )

    # Whichever layer decided, the draft is complete and self-consistent.
    assert draft.symbol == "SPY"
    assert draft.market_open is True
    assert draft.action in ("trade", "no_trade")
    assert draft.decision_source in ("llm", "risk_engine")
    assert draft.evidence["as_of"] == _evidence()["as_of"]
    assert draft.summary  # the dashboard renders this alone

    if draft.decision_source == "llm":
        assert draft.llm_model == settings.openrouter_model
        assert draft.llm_usage["total_tokens"] > 0
        assert draft.llm_reasoning.strip()
        if draft.action == "trade":
            # The only permissible trade is the approved candidate itself.
            assert "max loss $415.00" in draft.summary
    else:
        # OpenRouter was unreachable or the model never recorded a valid decision:
        # the fallback must say so, and must never have traded.
        assert draft.action == "no_trade"
        assert draft.llm_reasoning is not None
        assert "fallback" in draft.llm_reasoning.lower()
        # Usage is still recorded so the token budget stays auditable.
        assert isinstance(draft.llm_usage, dict)
        assert {"prompt_tokens", "completion_tokens", "total_tokens"} <= set(draft.llm_usage)