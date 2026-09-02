"""Integration tests: hit the real Alpaca market data API for options.

Marked `integration` — not part of the default fast unit-test run. Run explicitly with:
    pytest -m integration
"""

import pytest

from app.alpaca_client import get_option_data_client
from app.config import get_settings, load_strategy_config
from app.options.chain import fetch_chain_for_ladder, fetch_latest_quotes
from app.options.filter import filter_relevant_contracts

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def chain():
    settings = get_settings()
    client = get_option_data_client(settings)
    strategy = load_strategy_config()
    return fetch_chain_for_ladder(client, "SPY", strategy["tenor_scan"]["dte_ladder"])


def test_chain_is_non_empty(chain):
    assert len(chain) > 0


def test_snapshots_carry_greeks_or_iv(chain):
    with_data = [
        s for s in chain.values() if s.greeks is not None or s.implied_volatility is not None
    ]
    assert with_data, "expected at least some contracts to carry Greeks or IV"


def test_delta_filter_narrows_the_chain(chain):
    strategy = load_strategy_config()
    structure = strategy["structure"]
    relevant = filter_relevant_contracts(
        chain,
        delta_min=structure["short_leg_delta_min"],
        delta_max=structure["short_leg_delta_max"],
    )
    assert len(relevant) <= len(chain)
    for c in relevant:
        assert structure["short_leg_delta_min"] <= abs(c.delta) <= structure["short_leg_delta_max"]


def test_latest_quotes_price_real_contracts(chain):
    """R5 pricing source: leg-specific latest quotes by OCC symbol — the contracts an
    open spread holds may sit outside the scan ladder's window, so they are fetched by
    symbol, not from a chain."""
    settings = get_settings()
    client = get_option_data_client(settings)
    symbols = sorted(chain)[:5]
    quotes = fetch_latest_quotes(client, symbols)
    assert set(quotes) == set(symbols)
    for bid, ask in quotes.values():
        assert bid is None or bid >= 0
        assert ask is None or ask >= 0


def test_latest_quotes_of_unknown_symbols_come_back_missing():
    settings = get_settings()
    client = get_option_data_client(settings)
    quotes = fetch_latest_quotes(client, ["SPY999999C99999999"])
    assert quotes.get("SPY999999C99999999") in {(None, None), (0.0, 0.0)} or quotes == {}
