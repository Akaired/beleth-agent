"""Unit tests for the pre-trade risk check (R4 / R6 / R7). Synthetic data, no network.

Reference account for every case unless stated otherwise: equity $100,000, so with the
default strategy.yaml values the per-trade cap (2%) is $2,000 and the daily-drawdown stop
(3%) is $3,000; the concurrent-position limit is 5.
"""

from app.options.spreads import SpreadCandidate
from app.risk_check import (
    AccountRiskState,
    apply_aggregate_cap,
    check_r4,
    check_r6,
    check_r7,
    evaluate_candidate,
)

STRATEGY = {
    "risk": {
        "max_risk_per_trade_pct_of_equity": 2,
        "max_concurrent_positions": 5,
        "daily_drawdown_stop_pct": 3,
    }
}


def make_candidate(
    *,
    strike_width: float = 5.0,
    credit: float | None = 1.0,
    max_loss: float | None = 400.0,
    breakeven: float | None = 439.0,
) -> SpreadCandidate:
    return SpreadCandidate(
        symbol="SPY",
        right="P",
        expiry="2026-09-26",
        dte=30,
        short_strike=440.0,
        long_strike=435.0,
        strike_width=strike_width,
        delta_short=-0.20,
        credit=credit,
        max_loss=max_loss,
        breakeven=breakeven,
        net_quote_width=0.4,
    )


def state(
    *,
    equity: float = 100_000.0,
    open_positions: int = 0,
    day_pnl: float = 0.0,
    capital_at_risk: float = 0.0,
) -> AccountRiskState:
    return AccountRiskState(
        equity=equity,
        open_positions=open_positions,
        day_pnl=day_pnl,
        capital_at_risk=capital_at_risk,
    )


# --- R4: defined risk only --------------------------------------------------------------


def test_r4_approves_and_still_exposes_max_loss_and_breakeven():
    result = check_r4(make_candidate(max_loss=400.0, breakeven=439.0))
    assert result.passed is True
    assert result.detail["max_loss"] == 400.0
    assert result.detail["breakeven"] == 439.0
    assert "$400.00" in result.reason  # shown on approval, not only on rejection


def test_r4_rejects_when_max_loss_cannot_be_computed():
    result = check_r4(make_candidate(credit=None, max_loss=None, breakeven=None))
    assert result.passed is False
    assert "fails closed" in result.reason
    assert result.detail["max_loss"] is None


def test_r4_rejects_max_loss_above_structural_cap():
    # 5-wide vertical => structural cap is 5 * 100 = $500; 600 is impossible.
    result = check_r4(make_candidate(strike_width=5.0, max_loss=600.0))
    assert result.passed is False
    assert result.detail["structural_cap_usd"] == 500.0


def test_r4_rejects_non_positive_max_loss():
    result = check_r4(make_candidate(max_loss=0.0))
    assert result.passed is False


# --- R6: sizing (per-trade risk % + concurrent positions) -----------------------------


def test_r6_passes_when_risk_exactly_at_the_per_trade_cap():
    # cap = 2% of 100k = $2,000; a candidate risking exactly that is allowed.
    result = check_r6(
        make_candidate(max_loss=2_000.0),
        state(),
        max_risk_per_trade_pct=2,
        max_concurrent_positions=5,
    )
    assert result.passed is True
    assert result.detail["candidate_pct_of_equity"] == 2.0


def test_r6_rejects_when_risk_one_dollar_over_the_cap():
    result = check_r6(
        make_candidate(max_loss=2_001.0),
        state(),
        max_risk_per_trade_pct=2,
        max_concurrent_positions=5,
    )
    assert result.passed is False
    assert "per-trade cap" in result.reason


def test_r6_passes_with_zero_open_positions():
    result = check_r6(
        make_candidate(),
        state(open_positions=0),
        max_risk_per_trade_pct=2,
        max_concurrent_positions=5,
    )
    assert result.passed is True


def test_r6_passes_at_four_of_five_open_positions():
    result = check_r6(
        make_candidate(),
        state(open_positions=4),
        max_risk_per_trade_pct=2,
        max_concurrent_positions=5,
    )
    assert result.passed is True
    assert "4 of 5 position slots used" in result.reason


def test_r6_rejects_at_the_concurrent_position_limit():
    result = check_r6(
        make_candidate(),
        state(open_positions=5),
        max_risk_per_trade_pct=2,
        max_concurrent_positions=5,
    )
    assert result.passed is False
    assert "5-position limit" in result.reason


def test_r6_reports_both_problems_when_both_limits_are_breached():
    result = check_r6(
        make_candidate(max_loss=5_000.0),
        state(open_positions=6),
        max_risk_per_trade_pct=2,
        max_concurrent_positions=5,
    )
    assert result.passed is False
    assert "per-trade cap" in result.reason
    assert "position limit" in result.reason


def test_r6_surfaces_capital_already_at_risk_without_gating_on_it():
    result = check_r6(
        make_candidate(max_loss=400.0),
        state(capital_at_risk=1_234.0),
        max_risk_per_trade_pct=2,
        max_concurrent_positions=5,
    )
    assert result.passed is True
    assert result.detail["capital_at_risk_current"] == 1_234.0
    assert "$1,234.00 already at risk" in result.reason


# --- R7: daily drawdown stop ---------------------------------------------------------


def test_r7_passes_on_an_up_day():
    result = check_r7(state(day_pnl=500.0), daily_drawdown_stop_pct=3)
    assert result.passed is True
    assert result.detail["drawdown_usd"] == 0.0


def test_r7_passes_just_below_the_threshold():
    result = check_r7(state(day_pnl=-2_999.99), daily_drawdown_stop_pct=3)
    assert result.passed is True


def test_r7_trips_exactly_at_the_threshold():
    # drawdown of exactly 3% of 100k = $3,000 trips the stop.
    result = check_r7(state(day_pnl=-3_000.0), daily_drawdown_stop_pct=3)
    assert result.passed is False
    assert "daily stop" in result.reason
    assert result.detail["drawdown_pct"] == 3.0


def test_r7_trips_past_the_threshold():
    result = check_r7(state(day_pnl=-4_200.0), daily_drawdown_stop_pct=3)
    assert result.passed is False


# --- evaluate_candidate: the whole verdict ------------------------------------------


def test_verdict_approves_when_every_rule_passes():
    verdict = evaluate_candidate(make_candidate(max_loss=400.0), state(), STRATEGY)
    assert verdict.approved is True
    assert verdict.rejections == []
    assert verdict.max_loss == 400.0  # R4: exposed on the verdict itself
    assert verdict.breakeven == 439.0
    assert {r.rule for r in verdict.results} == {"R4", "R6", "R7"}


def test_verdict_rejects_on_daily_stop_alone_even_if_r4_and_r6_would_pass():
    verdict = evaluate_candidate(
        make_candidate(max_loss=400.0),
        state(day_pnl=-3_500.0),
        STRATEGY,
    )
    assert verdict.approved is False
    assert [r.rule for r in verdict.rejections] == ["R7"]
    r4 = next(r for r in verdict.results if r.rule == "R4")
    r6 = next(r for r in verdict.results if r.rule == "R6")
    assert r4.passed is True and r6.passed is True


def test_verdict_as_dict_shape():
    verdict = evaluate_candidate(make_candidate(), state(), STRATEGY)
    d = verdict.as_dict()
    assert set(d) == {
        "approved",
        "max_loss",
        "breakeven",
        "rejected_by",
        "results",
        "candidate",
    }
    assert d["rejected_by"] == []
    assert len(d["results"]) == 3


# --- R11: account-level aggregate risk cap (apply_aggregate_cap) -------------------------


def _approved_verdict(max_loss: float = 400.0):
    return evaluate_candidate(make_candidate(max_loss=max_loss), state(), STRATEGY)


def test_aggregate_cap_is_inert_at_zero():
    out = apply_aggregate_cap([_approved_verdict()], state(capital_at_risk=99_000.0),
                              max_aggregate_risk_pct=0)
    assert out[0].approved is True
    assert not any(r.rule == "R11" for r in out[0].results)


def test_aggregate_cap_admits_a_candidate_that_stays_within_the_cap():
    # cap = 5% of 100k = $5,000; $2,000 already at risk + $400 candidate = $2,400 < cap.
    out = apply_aggregate_cap([_approved_verdict(max_loss=400.0)],
                              state(capital_at_risk=2_000.0), max_aggregate_risk_pct=5)
    assert out[0].approved is True
    assert not any(r.rule == "R11" for r in out[0].results)


def test_aggregate_cap_rejects_with_an_r11_row_when_the_projection_breaches_it():
    # cap = $5,000; $4,800 at risk + $400 candidate = $5,200 > cap -> reject.
    out = apply_aggregate_cap([_approved_verdict(max_loss=400.0)],
                              state(capital_at_risk=4_800.0), max_aggregate_risk_pct=5)
    verdict = out[0]
    assert verdict.approved is False
    r11 = next(r for r in verdict.results if r.rule == "R11")
    assert r11.passed is False
    assert r11.detail["projected_capital_at_risk"] == 5_200.0
    assert r11.detail["aggregate_cap_usd"] == 5_000.0
    assert verdict.as_dict()["rejected_by"] == ["R11"]


def test_aggregate_cap_leaves_already_rejected_and_unknown_max_loss_verdicts_alone():
    rejected = evaluate_candidate(make_candidate(max_loss=400.0), state(day_pnl=-3_500.0),
                                  STRATEGY)
    unknown = evaluate_candidate(make_candidate(credit=None, max_loss=None, breakeven=None),
                                 state(), STRATEGY)  # R4 already fails this
    out = apply_aggregate_cap([rejected, unknown], state(capital_at_risk=99_000.0),
                              max_aggregate_risk_pct=5)
    assert not any(r.rule == "R11" for v in out for r in v.results)
