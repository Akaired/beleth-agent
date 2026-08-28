"""Unit tests for app/orders.py — sizing, mleg order construction, submission wrapper.

No network: the submission test uses a fake trading client, and the order request is
asserted through ``to_request_fields()`` — the exact payload the SDK would POST to
``/v2/orders`` — so the mleg conventions (order class, TIF, negative credit limit,
position intents) are pinned against the values verified in the vendored docs.
"""

import pytest

from datetime import date

from app.exits import OpenSpread
from app.options.spreads import SpreadCandidate
from app.orders import (
    OrderSubmissionError,
    build_closing_mleg_order,
    build_mleg_order,
    closing_limit_price,
    compute_quantity,
    credit_limit_price,
    describe_closing_legs,
    describe_legs,
    submit_mleg_order,
)


def make_candidate(right: str = "P") -> SpreadCandidate:
    """A well-formed 5-wide vertical: bull put (short 440 / long 435) or bear call
    (short 440 / long 445), with the leg symbols a real chain snapshot carries."""
    if right == "P":
        long_strike, long_symbol = 435.0, "SPY260918P00435000"
    else:
        long_strike, long_symbol = 445.0, "SPY260918C00445000"
    return SpreadCandidate(
        symbol="SPY",
        right=right,
        expiry="2026-09-18",
        dte=21,
        short_strike=440.0,
        long_strike=long_strike,
        strike_width=5.0,
        delta_short=-0.20 if right == "P" else 0.20,
        credit=1.0,
        max_loss=400.0,
        breakeven=439.0 if right == "P" else 441.0,
        net_quote_width=0.4,
        short_symbol="SPY260918P00440000" if right == "P" else "SPY260918C00440000",
        long_symbol=long_symbol,
    )


# --- sizing ---------------------------------------------------------------------------------


def test_quantity_fits_the_per_trade_cap():
    # $100k equity, 2% cap = $2,000; $140 max loss per spread -> 14 spreads.
    assert compute_quantity(100_000.0, 2.0, 140.0) == 14


def test_quantity_floors_partial_spreads():
    assert compute_quantity(100_000.0, 2.0, 150.0) == 13  # 13*150=1950 <= 2000 < 14*150


def test_quantity_zero_when_even_one_spread_breaks_the_cap():
    assert compute_quantity(10_000.0, 2.0, 400.0) == 0  # cap $200 < $400


def test_quantity_is_exactly_one_at_the_cap():
    assert compute_quantity(20_000.0, 2.0, 400.0) == 1  # cap $400 == max loss


@pytest.mark.parametrize("bad_loss", [None, 0.0, -140.0])
def test_quantity_fails_closed_on_unusable_max_loss(bad_loss):
    assert compute_quantity(100_000.0, 2.0, bad_loss) == 0


@pytest.mark.parametrize("bad_equity", [0.0, -100_000.0])
def test_quantity_fails_closed_on_unusable_equity(bad_equity):
    assert compute_quantity(bad_equity, 2.0, 140.0) == 0


# --- pricing --------------------------------------------------------------------------------


def test_credit_limit_is_negative_per_the_mleg_convention():
    # positive limit = debit, negative = credit (verified against the vendored SDK docs);
    # measured credit 1.00 minus 0.02 slippage -> demand a -0.98 net credit.
    assert credit_limit_price(1.0, 0.02) == -0.98


def test_credit_limit_floors_to_the_cent_never_demands_more_than_measured():
    # 0.605 - 0.02 = 0.585 -> floored to 0.58, never rounded up to 0.59.
    assert credit_limit_price(0.605, 0.02) == -0.58


def test_credit_limit_fails_closed_on_missing_or_non_positive_credit():
    assert credit_limit_price(None, 0.02) is None
    assert credit_limit_price(0.0, 0.02) is None
    assert credit_limit_price(-0.5, 0.02) is None


def test_credit_limit_fails_closed_when_slippage_eats_the_whole_credit():
    assert credit_limit_price(0.01, 0.02) is None  # net would be <= 0
    assert credit_limit_price(0.02, 0.02) is None


def test_credit_limit_with_zero_slippage_is_the_measured_credit():
    assert credit_limit_price(0.60, 0.0) == -0.60


# --- order construction -----------------------------------------------------------------------


def _request_fields(candidate, **kwargs):
    request = build_mleg_order(candidate, **kwargs)
    return request.to_request_fields()


def test_bull_put_order_sells_the_short_strike_and_buys_the_long():
    fields = _request_fields(
        make_candidate("P"), qty=3, limit_price=-0.98, client_order_id="beleth-x"
    )
    assert fields["qty"] == 3
    assert fields["order_class"] == "mleg"
    assert fields["type"] == "limit"
    assert fields["time_in_force"] == "day"  # the only TIF options support
    assert fields["limit_price"] == -0.98  # negative = net credit
    assert fields["client_order_id"] == "beleth-x"
    assert "symbol" not in fields  # mleg orders carry no top-level symbol
    assert "side" not in fields and "notional" not in fields

    short, long = fields["legs"]
    assert short == {
        "symbol": "SPY260918P00440000",
        "ratio_qty": 1,
        "side": "sell",
        "position_intent": "sell_to_open",
    }
    assert long == {
        "symbol": "SPY260918P00435000",
        "ratio_qty": 1,
        "side": "buy",
        "position_intent": "buy_to_open",
    }


def test_bear_call_order_uses_the_same_open_intents():
    fields = _request_fields(
        make_candidate("C"), qty=1, limit_price=-0.50, client_order_id="beleth-y"
    )
    short, long = fields["legs"]
    assert short["symbol"] == "SPY260918C00440000"
    assert short["position_intent"] == "sell_to_open"
    assert long["symbol"] == "SPY260918C00445000"
    assert long["position_intent"] == "buy_to_open"


def test_describe_legs_is_self_contained():
    legs = describe_legs(make_candidate("P"))
    assert [leg["role"] for leg in legs] == ["short", "long"]
    assert [leg["strike"] for leg in legs] == [440.0, 435.0]
    assert [leg["side"] for leg in legs] == ["sell", "buy"]
    assert legs[0]["symbol"] == "SPY260918P00440000"
    assert legs[1]["symbol"] == "SPY260918P00435000"


# --- closing (exit) pricing ---------------------------------------------------------------------


def make_open_spread() -> OpenSpread:
    """The account-side twin of ``make_candidate``: the same bull put, entry credit 0.90."""
    return OpenSpread(
        short_symbol="SPY260918P00440000",
        long_symbol="SPY260918P00435000",
        right="P",
        expiry=date(2026, 9, 18),
        short_strike=440.0,
        long_strike=435.0,
        qty=2,
        short_entry_price=1.20,
        long_entry_price=0.30,
    )


def test_closing_limit_pays_the_mark_plus_slippage():
    # Measured cost to close 0.90 + 0.05 concession -> 0.95 debit, floored to the cent.
    assert closing_limit_price(0.90, 0.05) == 0.95


def test_closing_limit_floors_to_the_cent():
    # 0.901 + 0.05 = 0.951 -> 0.95, never rounded up.
    assert closing_limit_price(0.901, 0.05) == 0.95


def test_closing_limit_demands_credit_minus_slippage_when_the_market_pays():
    # Mark -0.10 (market would pay us 0.10 to close): demand -0.05 credit.
    assert closing_limit_price(-0.10, 0.05) == -0.05


def test_closing_limit_falls_back_to_a_penny_debit_when_credit_cannot_absorb_slippage():
    # The market pays 0.03 to close; the 0.05 concession would swallow it. A guaranteed
    # exit is worth a cent.
    assert closing_limit_price(-0.03, 0.05) == 0.01


def test_closing_limit_fails_closed_on_an_unmeasured_mark():
    assert closing_limit_price(None, 0.05) is None


def test_closing_limit_with_zero_mark_is_a_penny_debit_not_zero():
    # A 0.00 limit on Alpaca is not a fillable debit; the fallback guarantees the exit.
    assert closing_limit_price(0.0, 0.05) == 0.05


# --- closing order construction -------------------------------------------------------------------


def test_closing_order_buys_back_the_short_and_sells_the_long():
    fields = build_closing_mleg_order(
        make_open_spread(), qty=2, limit_price=0.95, client_order_id="beleth-x"
    ).to_request_fields()
    assert fields["qty"] == 2
    assert fields["order_class"] == "mleg"
    assert fields["type"] == "limit"
    assert fields["time_in_force"] == "day"
    assert fields["limit_price"] == 0.95  # positive = net debit: we pay to get out
    assert fields["client_order_id"] == "beleth-x"

    short, long = fields["legs"]
    assert short == {
        "symbol": "SPY260918P00440000",
        "ratio_qty": 1,
        "side": "buy",
        "position_intent": "buy_to_close",
    }
    assert long == {
        "symbol": "SPY260918P00435000",
        "ratio_qty": 1,
        "side": "sell",
        "position_intent": "sell_to_close",
    }


def test_closing_order_can_demand_a_credit_with_a_negative_limit():
    fields = build_closing_mleg_order(
        make_open_spread(), qty=1, limit_price=-0.05, client_order_id="beleth-y"
    ).to_request_fields()
    assert fields["limit_price"] == -0.05
    short, _long = fields["legs"]
    assert short["position_intent"] == "buy_to_close"


def test_describe_closing_legs_mirrors_the_opening_intents():
    legs = describe_closing_legs(make_open_spread())
    assert [leg["role"] for leg in legs] == ["short", "long"]
    assert [leg["side"] for leg in legs] == ["buy", "sell"]
    assert [leg["position_intent"] for leg in legs] == ["buy_to_close", "sell_to_close"]
    assert [leg["strike"] for leg in legs] == [440.0, 435.0]
    assert legs[0]["symbol"] == "SPY260918P00440000"
    assert legs[1]["symbol"] == "SPY260918P00435000"


# --- submission ---------------------------------------------------------------------------------


class _FakeOrder:
    def __init__(self, payload):
        self._payload = payload

    def model_dump(self, mode="json"):
        return self._payload


class _FakeTradingClient:
    def __init__(self, *, error: Exception | None = None):
        self._error = error
        self.submitted = None

    def submit_order(self, request):
        if self._error is not None:
            raise self._error
        self.submitted = request
        return _FakeOrder({"id": "order-1", "status": "accepted", "legs": []})


def test_submit_mleg_order_returns_a_json_safe_dump():
    client = _FakeTradingClient()
    request = build_mleg_order(make_candidate(), 1, -0.98, "beleth-z")
    dump = submit_mleg_order(client, request)
    assert dump == {"id": "order-1", "status": "accepted", "legs": []}
    assert client.submitted is request


def test_submit_mleg_order_wraps_api_failures_for_the_caller_to_persist():
    client = _FakeTradingClient(error=RuntimeError("403: not authorized"))
    request = build_mleg_order(make_candidate(), 1, -0.98, "beleth-z")
    with pytest.raises(OrderSubmissionError) as excinfo:
        submit_mleg_order(client, request)
    assert "403" in str(excinfo.value)