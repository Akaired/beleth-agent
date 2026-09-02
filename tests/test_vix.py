from datetime import date

import pytest

from app.market.vix import (
    VixDataUnavailable,
    VixObservation,
    _parse_cboe_csv,
    _parse_fred_csv,
    percentile_of,
    rank_of,
    summarize_regime,
)

FRED_CSV = """observation_date,VIXCLS
2026-08-20,16.01
2026-08-21,15.13
2026-08-24,.
2026-08-25,15.45
"""

CBOE_CSV = """DATE,OPEN,HIGH,LOW,CLOSE
08/21/2026,15.5,16.0,15.0,15.13
08/25/2026,15.4,15.9,15.1,15.45
"""


def test_parse_fred_csv_skips_missing_values_and_sorts():
    obs = _parse_fred_csv(FRED_CSV)
    assert [o.value for o in obs] == [16.01, 15.13, 15.45]
    assert obs[0].day == date(2026, 8, 20)
    assert obs == sorted(obs, key=lambda o: o.day)


def test_parse_fred_csv_all_missing_raises():
    with pytest.raises(VixDataUnavailable):
        _parse_fred_csv("observation_date,VIXCLS\n2026-08-24,.\n")


def test_parse_cboe_csv_reads_close_column():
    obs = _parse_cboe_csv(CBOE_CSV)
    assert [o.value for o in obs] == [15.13, 15.45]
    assert obs[0].day == date(2026, 8, 21)


def test_percentile_and_rank_math():
    history = [10.0, 12.0, 14.0, 16.0, 18.0]
    assert percentile_of(history, 14.0) == pytest.approx(60.0)  # 3 of 5 <= 14
    assert rank_of(history, 14.0) == pytest.approx(50.0)  # midpoint of 10..18


def test_rank_flat_history_is_zero():
    assert rank_of([13.0, 13.0, 13.0], 13.0) == 0.0


def test_summarize_regime_uses_trailing_window():
    history = [VixObservation(date(2026, 1, i + 1), float(v)) for i, v in enumerate(range(10, 30))]
    regime = summarize_regime(history, lookback_trading_days=5)
    assert regime.level == 29.0
    assert regime.lookback_points == 5
    assert regime.rank_1y == pytest.approx(100.0)  # latest is the max of the last 5
    assert regime.percentile_1y == pytest.approx(100.0)


def test_summarize_regime_empty_raises():
    with pytest.raises(VixDataUnavailable):
        summarize_regime([], lookback_trading_days=5)
