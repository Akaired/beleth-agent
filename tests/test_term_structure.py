from dataclasses import dataclass
from datetime import date

from app.market.term_structure import (
    BACKWARDATION,
    CONTANGO,
    FLAT,
    atm_iv_for_expiry,
    classify,
)


@dataclass
class FakeSnapshot:
    implied_volatility: float | None


def occ(expiry: date, right: str, strike: float, root: str = "SPY") -> str:
    return f"{root}{expiry:%y%m%d}{right}{round(strike * 1000):08d}"


TODAY = date(2026, 8, 27)
SHORT = date(2026, 9, 3)  # 7 DTE
LONG = date(2026, 10, 11)  # 45 DTE


def _chain():
    return {
        occ(SHORT, "C", 450): FakeSnapshot(0.150),
        occ(SHORT, "P", 450): FakeSnapshot(0.160),
        occ(SHORT, "P", 430): FakeSnapshot(0.190),  # further OTM, higher IV (skew) — ignored for ATM
        occ(LONG, "C", 450): FakeSnapshot(0.180),
        occ(LONG, "P", 450): FakeSnapshot(0.182),
        occ(LONG, "C", 470): FakeSnapshot(0.175),
    }


def test_atm_iv_picks_nearest_strike_and_averages_call_put():
    iv = atm_iv_for_expiry(
        _chain(),
        target_dte=7,
        today_ordinal=TODAY.toordinal(),
        underlying_last=451.0,
        strike_tolerance_pct=1.0,
    )
    assert iv == (0.150 + 0.160) / 2


def test_atm_iv_returns_none_when_nothing_in_tolerance_has_iv():
    chain = {occ(SHORT, "C", 600): FakeSnapshot(None)}
    iv = atm_iv_for_expiry(
        chain,
        target_dte=7,
        today_ordinal=TODAY.toordinal(),
        underlying_last=451.0,
        strike_tolerance_pct=1.0,
    )
    assert iv is None


def test_classify_contango_backwardation_flat():
    assert classify(0.15, 0.18, 7, 45, flat_band_iv=0.005).state == CONTANGO
    assert classify(0.20, 0.15, 7, 45, flat_band_iv=0.005).state == BACKWARDATION
    assert classify(0.180, 0.182, 7, 45, flat_band_iv=0.005).state == FLAT


def test_classify_missing_leg_is_flat():
    assert classify(None, 0.18, 7, 45, flat_band_iv=0.005).state == FLAT
