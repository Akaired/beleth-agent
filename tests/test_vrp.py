from dataclasses import dataclass
from datetime import date

import pytest

from app.vrp import TenorVrp, best_tradable_tenor, scan_tenors, vrp_points


@dataclass
class FakeSnapshot:
    implied_volatility: float | None


def occ(expiry: date, right: str, strike: float, root: str = "SPY") -> str:
    return f"{root}{expiry:%y%m%d}{right}{int(round(strike * 1000)):08d}"


TODAY = date(2026, 8, 27)


def test_vrp_points_in_volatility_points():
    assert vrp_points(0.162, 0.134) == pytest.approx(2.8)


def test_scan_marks_only_tenors_above_threshold():
    d7 = date(2026, 9, 3)
    d30 = date(2026, 9, 26)
    chain = {
        occ(d7, "C", 450): FakeSnapshot(0.140),
        occ(d7, "P", 450): FakeSnapshot(0.140),
        occ(d30, "C", 450): FakeSnapshot(0.180),
        occ(d30, "P", 450): FakeSnapshot(0.180),
    }
    results = scan_tenors(
        chain,
        dte_ladder=[7, 30],
        today_ordinal=TODAY.toordinal(),
        underlying_last=450.0,
        rv20=0.130,
        threshold_vol_points=1.5,
        strike_tolerance_pct=1.0,
    )
    by_dte = {r.dte: r for r in results}
    assert by_dte[7].vrp_vs_rv20 == pytest.approx(1.0)
    assert by_dte[7].passes_threshold is False
    assert by_dte[30].vrp_vs_rv20 == pytest.approx(5.0)
    assert by_dte[30].passes_threshold is True


def test_scan_without_rv20_marks_nothing_tradable():
    d30 = date(2026, 9, 26)
    chain = {
        occ(d30, "C", 450): FakeSnapshot(0.180),
        occ(d30, "P", 450): FakeSnapshot(0.180),
    }
    results = scan_tenors(
        chain,
        dte_ladder=[30],
        today_ordinal=TODAY.toordinal(),
        underlying_last=450.0,
        rv20=None,
        threshold_vol_points=1.5,
        strike_tolerance_pct=1.0,
    )
    assert results[0].atm_iv == 0.180
    assert results[0].vrp_vs_rv20 is None
    assert results[0].passes_threshold is False


def test_best_tradable_tenor_picks_highest_passing_vrp():
    tenors = [
        TenorVrp(dte=7, atm_iv=0.14, vrp_vs_rv20=1.0, passes_threshold=False),
        TenorVrp(dte=21, atm_iv=0.17, vrp_vs_rv20=3.0, passes_threshold=True),
        TenorVrp(dte=45, atm_iv=0.19, vrp_vs_rv20=5.0, passes_threshold=True),
    ]
    assert best_tradable_tenor(tenors).dte == 45


def test_best_tradable_tenor_none_when_nothing_passes():
    tenors = [TenorVrp(dte=7, atm_iv=0.14, vrp_vs_rv20=1.0, passes_threshold=False)]
    assert best_tradable_tenor(tenors) is None
