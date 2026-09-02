"""Integration test: the order path builds a valid mleg request from the REAL chain.

Marked `integration` — not part of the default fast unit run. Run explicitly with:
    pytest -m integration

**Dry run only — this test never submits an order.** It fetches the live SPY chain,
builds real spread candidates, and pushes one through sizing, pricing and
``build_mleg_order``, asserting the request the SDK would POST is well-formed and carries
the chain's own OCC symbols. Live submission is exercised by the cycle
(``scripts/check_market_data.py``) and the order-path smoke, not by the test suite —
a test run must not leave positions behind.
"""

from datetime import datetime

import pytest

from app.alpaca_client import assert_paper_trading, get_option_data_client, get_trading_client
from app.config import get_settings, load_strategy_config
from app.options.chain import fetch_chain_for_ladder
from app.options.spreads import build_candidates
from app.orders import build_mleg_order, compute_quantity, credit_limit_price

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def strategy():
    return load_strategy_config()


@pytest.fixture(scope="module")
def priced_candidate(strategy):
    """A real candidate with a computable credit, straight from the live chain."""
    settings = get_settings()
    trading = get_trading_client(settings)
    assert_paper_trading(trading)
    option_client = get_option_data_client(settings)
    chain = fetch_chain_for_ladder(
        option_client, "SPY", strategy["tenor_scan"]["dte_ladder"]
    )
    structure = strategy["structure"]
    candidates = build_candidates(
        chain,
        underlying="SPY",
        target_dtes=strategy["tenor_scan"]["dte_ladder"],
        today_ordinal=datetime.now().toordinal(),
        delta_min=structure["short_leg_delta_min"],
        delta_max=structure["short_leg_delta_max"],
        width_min=structure["strike_width_usd_min"],
        width_max=structure["strike_width_usd_max"],
    )
    priced = [c for c in candidates if c.credit is not None and c.credit > 0]
    if not priced:
        pytest.skip("no priced candidate in the live chain right now")
    return priced[0]


def test_candidate_carries_its_own_chain_symbols(priced_candidate):
    # The order path submits exactly the contracts that were measured — the OCC symbols
    # must come from the chain, never be rebuilt from (expiry, strike, right).
    assert priced_candidate.short_symbol and priced_candidate.long_symbol
    assert priced_candidate.short_symbol != priced_candidate.long_symbol
    assert priced_candidate.short_symbol.startswith("SPY")
    assert priced_candidate.long_symbol.startswith("SPY")


def test_sizing_and_pricing_produce_a_sendable_plan(strategy, priced_candidate):
    account = get_trading_client(get_settings()).get_account()
    equity = float(account.equity)
    qty = compute_quantity(
        equity,
        strategy["risk"]["max_risk_per_trade_pct_of_equity"],
        priced_candidate.max_loss,
    )
    limit = credit_limit_price(
        priced_candidate.credit, strategy["structure"]["credit_slippage_usd"]
    )
    # Whatever the market, the two fail-closed answers must agree with each other and
    # with the gate's own arithmetic: a positive limit credit exists iff one spread fits.
    if priced_candidate.max_loss is not None and priced_candidate.max_loss <= (
        equity * strategy["risk"]["max_risk_per_trade_pct_of_equity"] / 100
    ):
        assert qty >= 1
        assert limit is not None and limit < 0
    else:
        assert qty == 0


def test_mleg_request_is_well_formed_against_the_real_chain(strategy, priced_candidate):
    limit = credit_limit_price(
        priced_candidate.credit, strategy["structure"]["credit_slippage_usd"]
    )
    if limit is None:
        pytest.skip("candidate credit cannot absorb the slippage concession right now")

    request = build_mleg_order(
        priced_candidate, qty=1, limit_price=limit, client_order_id="beleth-test"
    )
    fields = request.to_request_fields()  # exactly what the SDK POSTs to /v2/orders
    assert fields["order_class"] == "mleg"
    assert fields["type"] == "limit"
    assert fields["time_in_force"] == "day"
    assert fields["qty"] == 1
    assert fields["limit_price"] == limit and limit < 0

    legs = fields["legs"]
    assert [leg["position_intent"] for leg in legs] == ["sell_to_open", "buy_to_open"]
    assert [leg["side"] for leg in legs] == ["sell", "buy"]
    assert legs[0]["symbol"] == priced_candidate.short_symbol
    assert legs[1]["symbol"] == priced_candidate.long_symbol
