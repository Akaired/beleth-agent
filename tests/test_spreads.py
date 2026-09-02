from dataclasses import dataclass
from datetime import date

from app.options.spreads import build_candidates


@dataclass
class FakeGreeks:
    delta: float


@dataclass
class FakeQuote:
    bid_price: float | None
    ask_price: float | None


@dataclass
class FakeSnapshot:
    greeks: FakeGreeks | None
    latest_quote: FakeQuote | None


def occ(expiry: date, right: str, strike: float, root: str = "SPY") -> str:
    return f"{root}{expiry:%y%m%d}{right}{round(strike * 1000):08d}"


TODAY = date(2026, 8, 27)
EXP = date(2026, 9, 26)  # 30 DTE


def _put_chain():
    # Short put ~0.20 delta at 440, protective puts below it.
    return {
        occ(EXP, "P", 445): FakeSnapshot(FakeGreeks(-0.30), FakeQuote(3.00, 3.20)),
        occ(EXP, "P", 440): FakeSnapshot(FakeGreeks(-0.20), FakeQuote(2.00, 2.20)),
        occ(EXP, "P", 438): FakeSnapshot(FakeGreeks(-0.15), FakeQuote(1.50, 1.70)),
        occ(EXP, "P", 435): FakeSnapshot(FakeGreeks(-0.10), FakeQuote(1.00, 1.20)),
    }


def test_builds_bull_put_spread_with_bounded_loss():
    candidates = build_candidates(
        _put_chain(),
        underlying="SPY",
        target_dtes=[30],
        today_ordinal=TODAY.toordinal(),
        delta_min=0.15,
        delta_max=0.25,
        width_min=5.0,
        width_max=5.0,
    )
    puts = [c for c in candidates if c.right == "P"]
    assert len(puts) == 1
    spread = puts[0]
    assert spread.short_strike == 440.0
    assert spread.long_strike == 435.0
    assert spread.strike_width == 5.0
    # credit = short mid (2.10) - long mid (1.10) = 1.00
    assert spread.credit == 1.0
    # max loss = (5 - 1) * 100 = 400, strictly bounded
    assert spread.max_loss == 400.0
    assert spread.breakeven == 439.0  # 440 - 1.00
    assert 0 < spread.max_loss < spread.strike_width * 100


def test_no_candidate_when_no_contract_in_delta_band():
    chain = {
        occ(EXP, "P", 445): FakeSnapshot(FakeGreeks(-0.40), FakeQuote(3.0, 3.2)),
        occ(EXP, "P", 435): FakeSnapshot(FakeGreeks(-0.05), FakeQuote(1.0, 1.2)),
    }
    candidates = build_candidates(
        chain, underlying="SPY", target_dtes=[30], today_ordinal=TODAY.toordinal(),
        delta_min=0.15, delta_max=0.25, width_min=5.0, width_max=5.0,
    )
    assert candidates == []


def test_missing_quotes_leave_economics_none_but_still_a_structure():
    chain = {
        occ(EXP, "P", 440): FakeSnapshot(FakeGreeks(-0.20), FakeQuote(None, None)),
        occ(EXP, "P", 435): FakeSnapshot(FakeGreeks(-0.10), FakeQuote(None, None)),
    }
    candidates = build_candidates(
        chain, underlying="SPY", target_dtes=[30], today_ordinal=TODAY.toordinal(),
        delta_min=0.15, delta_max=0.25, width_min=5.0, width_max=5.0,
    )
    assert len(candidates) == 1
    assert candidates[0].credit is None
    assert candidates[0].max_loss is None
    assert candidates[0].strike_width == 5.0
