"""Unit tests for the pre-trade risk check (R4 / R6 / R7). Synthetic data, no network.

Reference account for every case unless stated otherwise: equity $100,000, so with the
default strategy.yaml values the per-trade cap (2%) is $2,000 and the daily-drawdown stop
(3%) is $3,000; the concurrent-position limit is 5.
"""

import pytest

from app.options.spreads import SpreadCandidate
from app.risk_check import (
    AccountRiskState,
    apply_aggregate_cap,
    apply_vix_regime,
    block_entries,
    check_r4,
    check_r6,
    check_r7,
    evaluate_candidate,
    vix_size_multiplier,
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


# --- R10: entry blocked by account state (block_entries, split off R6 on 2026-08-28) -----


def _approved_verdict(max_loss: float = 400.0):
    return evaluate_candidate(make_candidate(max_loss=max_loss), state(), STRATEGY)


def test_block_entries_is_a_noop_without_blocks():
    verdicts = [_approved_verdict()]
    out = block_entries(verdicts, [])
    assert out[0].approved is True
    assert [r.rule for r in out[0].results] == ["R4", "R6", "R7"]


def test_block_entries_flips_approved_verdicts_with_an_r10_row_not_r6():
    blocks = [
        {
            "kind": "resting_entry_order",
            "reason": "an entry order is already resting on the account",
        }
    ]
    out = block_entries([_approved_verdict()], blocks)
    verdict = out[0]
    assert verdict.approved is False
    r10 = [r for r in verdict.results if r.rule == "R10"]
    assert len(r10) == 1
    # The whole point of the split: this rejection is NOT labelled R6 (real sizing).
    assert not any(r.rule == "R6" and not r.passed for r in verdict.results)
    assert r10[0].detail["kinds"] == ["resting_entry_order"]
    assert "already resting" in r10[0].reason
    assert verdict.as_dict()["rejected_by"] == ["R10"]


def test_block_entries_keeps_distinct_kinds_and_leaves_rejected_verdicts_untouched():
    already_rejected = evaluate_candidate(
        make_candidate(max_loss=400.0),
        state(day_pnl=-3_500.0),
        STRATEGY,  # R7 trips
    )
    assert already_rejected.approved is False
    blocks = [
        {"kind": "position_anomaly", "reason": "a naked short leg is open"},
        {"kind": "resting_entry_order", "reason": "an entry order is already resting"},
    ]
    out = block_entries([_approved_verdict(), already_rejected], blocks)
    assert [r.rule for r in out[0].results if r.rule == "R10"]
    assert out[0].results[-1].detail["kinds"] == ["position_anomaly", "resting_entry_order"]
    # A verdict that was already rejected gets no extra R10 row bolted on.
    assert [r.rule for r in out[1].results] == [r.rule for r in already_rejected.results]


# --- R11: account-level aggregate risk cap (apply_aggregate_cap) -------------------------


def test_aggregate_cap_is_inert_at_zero():
    out = apply_aggregate_cap(
        [_approved_verdict()], state(capital_at_risk=99_000.0), max_aggregate_risk_pct=0
    )
    assert out[0].approved is True
    assert not any(r.rule == "R11" for r in out[0].results)


def test_aggregate_cap_admits_a_candidate_that_stays_within_the_cap():
    # cap = 5% of 100k = $5,000; $2,000 already at risk + $400 candidate = $2,400 < cap.
    out = apply_aggregate_cap(
        [_approved_verdict(max_loss=400.0)],
        state(capital_at_risk=2_000.0),
        max_aggregate_risk_pct=5,
    )
    assert out[0].approved is True
    assert not any(r.rule == "R11" for r in out[0].results)


def test_aggregate_cap_rejects_with_an_r11_row_when_the_projection_breaches_it():
    # cap = $5,000; $4,800 at risk + $400 candidate = $5,200 > cap -> reject.
    out = apply_aggregate_cap(
        [_approved_verdict(max_loss=400.0)],
        state(capital_at_risk=4_800.0),
        max_aggregate_risk_pct=5,
    )
    verdict = out[0]
    assert verdict.approved is False
    r11 = next(r for r in verdict.results if r.rule == "R11")
    assert r11.passed is False
    assert r11.detail["projected_capital_at_risk"] == 5_200.0
    assert r11.detail["aggregate_cap_usd"] == 5_000.0
    assert verdict.as_dict()["rejected_by"] == ["R11"]


def test_aggregate_cap_leaves_already_rejected_and_unknown_max_loss_verdicts_alone():
    rejected = evaluate_candidate(make_candidate(max_loss=400.0), state(day_pnl=-3_500.0), STRATEGY)
    unknown = evaluate_candidate(
        make_candidate(credit=None, max_loss=None, breakeven=None), state(), STRATEGY
    )  # R4 already fails this
    out = apply_aggregate_cap(
        [rejected, unknown], state(capital_at_risk=99_000.0), max_aggregate_risk_pct=5
    )
    assert not any(r.rule == "R11" for v in out for r in v.results)


# --- R9: VIX-regime size taper (vix_size_multiplier / apply_vix_regime) ------------------
#
# Calibration used in these cases mirrors the intended shape once enabled: a single line
# from percentile 25 (full size) to percentile 3 (floor 0.5), hard block below 3. The four
# probe percentiles are the ones from the historical analysis.

_TAPER = dict(taper_upper_pct=25, taper_lower_pct=3, taper_floor_frac=0.5, block_below_pct=3)


def test_vix_taper_is_inert_with_all_zero_defaults():
    mult, reason = vix_size_multiplier(
        8.0, taper_upper_pct=0, taper_lower_pct=0, taper_floor_frac=1.0, block_below_pct=0
    )
    assert mult == 1.0
    assert "full size" in reason


def test_vix_taper_full_size_at_percentile_30():
    mult, reason = vix_size_multiplier(30.0, **_TAPER)
    assert mult == 1.0
    assert "at or above" in reason


def test_vix_taper_intermediate_at_percentile_15():
    # single slope 25 -> 3: fraction = 0.5 + 0.5 * (15 - 3) / (25 - 3) = 0.5 + 0.5 * 12/22.
    mult, _ = vix_size_multiplier(15.0, **_TAPER)
    assert mult == pytest.approx(0.5 + 0.5 * (12 / 22))
    assert 0.5 < mult < 1.0


def test_vix_taper_reduces_but_does_not_block_at_percentile_3_97():
    # 3.97 is above the block floor (3): a smaller trade, not a no-trade.
    mult, reason = vix_size_multiplier(3.97, **_TAPER)
    assert 0.5 <= mult < 0.53
    assert mult > 0.0
    assert "scaled to" in reason


def test_vix_taper_hard_blocks_at_percentile_2():
    mult, reason = vix_size_multiplier(2.0, **_TAPER)
    assert mult == 0.0
    assert "block floor" in reason


def test_vix_taper_holds_the_floor_between_lower_and_block_thresholds():
    # lower 5, block 3: percentile 4 sits between them -> floor fraction, still not blocked.
    cfg = dict(taper_upper_pct=25, taper_lower_pct=5, taper_floor_frac=0.5, block_below_pct=3)
    mult, _ = vix_size_multiplier(4.0, **cfg)
    assert mult == 0.5


def test_vix_taper_unknown_percentile_never_blocks():
    mult, reason = vix_size_multiplier(None, **_TAPER)
    assert mult == 1.0
    assert "unavailable" in reason


def test_apply_vix_regime_is_a_noop_for_a_partial_taper():
    verdicts = [_approved_verdict()]
    out = apply_vix_regime(verdicts, 0.5, "R9 (VIX taper): scaled to 50%.")
    assert out[0].approved is True
    assert not any(r.rule == "R9" for r in out[0].results)


def test_apply_vix_regime_hard_block_rejects_with_an_r9_row():
    out = apply_vix_regime([_approved_verdict()], 0.0, "R9 (VIX taper): below the block floor.")
    verdict = out[0]
    assert verdict.approved is False
    r9 = next(r for r in verdict.results if r.rule == "R9")
    assert r9.passed is False
    assert r9.detail["vix_size_multiplier"] == 0.0
    assert verdict.as_dict()["rejected_by"] == ["R9"]


def test_apply_vix_regime_hard_block_leaves_already_rejected_verdicts_untouched():
    rejected = evaluate_candidate(make_candidate(max_loss=400.0), state(day_pnl=-3_500.0), STRATEGY)
    out = apply_vix_regime([rejected], 0.0, "R9 block")
    assert [r.rule for r in out[0].results] == [r.rule for r in rejected.results]
