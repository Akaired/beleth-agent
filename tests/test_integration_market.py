"""Integration tests for the milestone-2 market-context inputs: FRED VIX, realized
volatility from real SPY bars, and term structure from the real SPY chain.

Marked `integration` — run explicitly with:
    pytest -m integration
"""

from datetime import date, timedelta

import pytest

from app.alpaca_client import get_option_data_client, get_stock_data_client
from app.config import get_settings, load_strategy_config
from app.market.realized_vol import realized_vol_for_windows
from app.market.term_structure import BACKWARDATION, CONTANGO, FLAT, atm_iv_for_expiry, classify
from app.market.underlying import fetch_daily_closes, fetch_last_price
from app.market.vix import fetch_vix_history, summarize_regime
from app.options.chain import fetch_chain_for_ladder

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def strategy():
    return load_strategy_config()


def test_fred_vix_csv_is_reachable_without_a_key(strategy):
    vix_cfg = strategy["vix"]
    history = fetch_vix_history(vix_cfg["fred_csv_url"])
    assert len(history) > 1000  # decades of daily history
    assert history[-1].day > date.today() - timedelta(days=10)
    assert 5 < history[-1].value < 100  # sane VIX level

    regime = summarize_regime(history, vix_cfg["lookback_trading_days"])
    assert 0 <= regime.percentile_1y <= 100
    assert 0 <= regime.rank_1y <= 100


def test_realized_vol_from_real_spy_bars_is_plausible(strategy):
    client = get_stock_data_client(get_settings())
    closes = fetch_daily_closes(client, "SPY", lookback_days=90)
    assert len(closes) > 40

    rvs = realized_vol_for_windows(closes, strategy["realized_vol"]["windows_days"])
    rv20 = rvs[20].value
    assert rv20 is not None
    assert 0.01 < rv20 < 2.0  # annualized fraction — SPY is not 0% nor 200% vol


def test_term_structure_from_real_chain_classifies(strategy):
    settings = get_settings()
    option_client = get_option_data_client(settings)
    stock_client = get_stock_data_client(settings)

    ladder = strategy["tenor_scan"]["dte_ladder"]
    chain = fetch_chain_for_ladder(option_client, "SPY", ladder)
    last = fetch_last_price(stock_client, "SPY")
    today_ordinal = date.today().toordinal()
    tol = strategy["tenor_scan"]["atm_strike_tolerance_pct"]

    short_iv = atm_iv_for_expiry(chain, min(ladder), today_ordinal, last, tol)
    long_iv = atm_iv_for_expiry(chain, max(ladder), today_ordinal, last, tol)
    assert short_iv is not None and long_iv is not None

    ts = classify(
        short_iv,
        long_iv,
        min(ladder),
        max(ladder),
        strategy["regime"]["term_structure_flat_band_iv"],
    )
    assert ts.state in {CONTANGO, BACKWARDATION, FLAT}
