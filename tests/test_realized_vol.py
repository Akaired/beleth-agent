import math

import pytest

from app.market.realized_vol import realized_vol, realized_vol_for_windows


def test_zero_variance_series_has_zero_vol():
    closes = [100.0] * 40
    result = realized_vol(closes, window_days=20)
    assert result.value == 0.0
    assert result.returns_used == 20


def test_insufficient_history_returns_none():
    result = realized_vol([100.0, 101.0, 102.0], window_days=20)
    assert result.value is None
    assert result.returns_used == 0


def test_known_constant_log_return_annualizes_as_expected():
    # A perfectly constant daily log return has zero sample stdev -> zero realized vol.
    closes = [100.0 * (1.01**i) for i in range(41)]
    result = realized_vol(closes, window_days=20, annualization_trading_days=252)
    assert result.value == pytest.approx(0.0, abs=1e-9)


def test_alternating_returns_match_hand_computation():
    # Closes bounce between 100 and 101: log returns alternate +r and -r.
    r = math.log(101 / 100)
    closes = []
    price = 100.0
    for _ in range(41):
        closes.append(price)
        price = 101.0 if price == 100.0 else 100.0
    result = realized_vol(closes, window_days=20, annualization_trading_days=252)

    # log returns are ±r with equal count over an even window -> mean 0,
    # sample variance = sum(r^2)/(n-1) = n*r^2/(n-1) with n=20.
    n = 20
    expected_daily = math.sqrt(n * r * r / (n - 1))
    expected = expected_daily * math.sqrt(252)
    assert result.value == pytest.approx(expected)


def test_windows_helper_returns_entry_per_window():
    closes = [100.0 + i for i in range(30)]  # 30 closes -> 29 returns
    out = realized_vol_for_windows(closes, [10, 20, 30])
    assert set(out) == {10, 20, 30}
    assert out[10].value is not None
    assert out[20].value is not None
    assert out[30].value is None  # needs 31 closes


def test_window_below_two_rejected():
    with pytest.raises(ValueError):
        realized_vol([1.0, 2.0, 3.0], window_days=1)
