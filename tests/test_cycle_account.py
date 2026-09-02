"""`gather_account_state` — the stage that decides what new risk is even allowed.

Everything that must refuse a new entry regardless of a candidate's own merits is
decided here and carried as an `entry_block`: an unpaired leg, a spread whose risk
cannot be sized, a resting entry order, an unreadable order book. Each becomes a
visible R10 rejection row downstream, so getting this wrong is either a silent skip or
a stacked position.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

from app.config import load_strategy_config
from app.cycle.account import gather_account_state
from app.cycle.context import Clients, CycleConfig
from app.market.calendar import EASTERN
from tests.cycle_fakes import (
    FakeOptionClient,
    FakeQuote,
    FakeStockClient,
    FakeTradingClient,
    occ,
    position,
    put_credit_chain,
)

TODAY = date.today()
EXPIRY = TODAY + timedelta(days=21)
SHORT = occ(EXPIRY, "P", 440)
LONG = occ(EXPIRY, "P", 435)


def _cfg() -> CycleConfig:
    return CycleConfig(
        symbol="SPY",
        strategy=load_strategy_config(),
        today_ordinal=TODAY.toordinal(),
        now_et=datetime.now(EASTERN),
    )


def _clients(trading, *, quotes=None, quotes_error=None) -> Clients:
    return Clients(
        trading=trading,
        options=FakeOptionClient(
            put_credit_chain(today=TODAY, dtes=[21]),
            quotes=quotes,
            quotes_error=quotes_error,
        ),
        stocks=FakeStockClient(),
    )


def _paired_spread(**kwargs):
    return FakeTradingClient(
        positions=[
            position(SHORT, -2, 2.00, "short"),
            position(LONG, 2, 0.50, "long"),
        ],
        **kwargs,
    )


# ── the account itself ───────────────────────────────────────────────────────


def test_an_empty_account_blocks_nothing_and_risks_nothing():
    state = gather_account_state(_clients(FakeTradingClient()), _cfg())
    assert state.entry_blocks == []
    assert state.capital_at_risk == 0.0
    assert state.open_position_count == 0
    assert state.open_spreads == []


def test_equity_and_day_pnl_come_off_the_account():
    trading = FakeTradingClient(equity=101_500.0, last_equity=100_000.0)
    state = gather_account_state(_clients(trading), _cfg())
    assert state.equity == 101_500.0
    assert state.day_pnl == 1500.0
    assert state.risk_state.equity == 101_500.0


def test_the_remaining_daily_risk_budget_never_goes_negative():
    """R7's budget is what is still absorbable today. A drawdown past the stop leaves
    zero, not a negative number that would read as headroom."""
    deep = FakeTradingClient(equity=100_000.0, last_equity=120_000.0)
    state = gather_account_state(_clients(deep), _cfg())
    assert state.snapshot.risk_budget_remaining_today == 0.0

    flat = FakeTradingClient(equity=100_000.0, last_equity=100_000.0)
    state = gather_account_state(_clients(flat), _cfg())
    # 3% of equity, the shipped daily_drawdown_stop_pct.
    assert state.snapshot.risk_budget_remaining_today > 0


# ── pairing, and what fails to pair ──────────────────────────────────────────


def test_two_legs_pair_into_one_spread_counted_as_one_position():
    """The risk gate counts spreads — the strategy's unit — not raw legs."""
    state = gather_account_state(_clients(_paired_spread()), _cfg())
    assert len(state.open_spreads) == 1
    assert state.open_position_count == 1
    assert state.position_anomalies == []
    # (width 5 - credit 1.50) * 100 * 2 contracts
    assert state.capital_at_risk == 700.0


def test_a_naked_leg_becomes_an_entry_block_not_a_silent_skip():
    trading = FakeTradingClient(positions=[position(SHORT, -2, 2.00, "short")])
    state = gather_account_state(_clients(trading), _cfg())
    assert state.position_anomalies
    kinds = {b["kind"] for b in state.entry_blocks}
    assert kinds == {"position_anomaly"}
    # An unpaired leg still counts against the position cap.
    assert state.open_position_count == 1


def test_a_spread_whose_credit_cannot_be_computed_blocks_new_entries():
    """The gate must not add risk it cannot size. An unreadable `avg_entry_price` pairs
    into a spread with no entry credit — which is not an anomaly, so it needs its own
    block or it would slip through."""
    trading = FakeTradingClient(
        positions=[
            _position_without_entry_price(SHORT, -2, "short"),
            _position_without_entry_price(LONG, 2, "long"),
        ]
    )
    state = gather_account_state(_clients(trading), _cfg())
    assert len(state.open_spreads) == 1
    assert state.open_spreads[0].entry_credit is None
    assert state.position_anomalies == []
    reasons = " ".join(b["reason"] for b in state.entry_blocks)
    assert "risk cannot be sized" in reasons


def _position_without_entry_price(symbol: str, qty: float, side: str):
    """Alpaca has returned a null `avg_entry_price` on option legs; `pair_open_spreads`
    reads it as an unknown, not a zero."""
    from types import SimpleNamespace

    dump = {
        "symbol": symbol,
        "qty": str(qty),
        "side": side,
        "avg_entry_price": None,
        "asset_class": "us_option",
    }
    return SimpleNamespace(model_dump=lambda mode="json": dict(dump))


# ── resting orders ───────────────────────────────────────────────────────────


class _FakeLeg:
    def __init__(self, symbol: str, intent: str) -> None:
        self.symbol = symbol
        self.position_intent = intent


class _FakeOrder:
    def __init__(self, *legs, client_order_id: str = "") -> None:
        self.legs = list(legs)
        self.client_order_id = client_order_id


def test_a_resting_entry_order_blocks_a_second_one():
    """The incident this exists for: without it the resident loop stacks a new entry
    order on the same strikes every five minutes."""
    resting = _FakeOrder(_FakeLeg(SHORT, "sell_to_open"), _FakeLeg(LONG, "buy_to_open"))
    state = gather_account_state(_clients(FakeTradingClient(open_orders=[resting])), _cfg())
    assert [b["kind"] for b in state.entry_blocks] == ["resting_entry_order"]


def test_a_resting_closing_order_does_not_block_a_new_entry():
    closing = _FakeOrder(_FakeLeg(SHORT, "buy_to_close"), _FakeLeg(LONG, "sell_to_close"))
    state = gather_account_state(_clients(FakeTradingClient(open_orders=[closing])), _cfg())
    assert state.entry_blocks == []
    assert state.open_orders == [closing]


def test_an_unreadable_order_book_fails_closed():
    """Fail-closed for both paths: with the order book unreadable a resting entry
    cannot be ruled out, and a duplicate close cannot be ruled out either."""
    trading = FakeTradingClient(orders_error=RuntimeError("alpaca 503"))
    state = gather_account_state(_clients(trading), _cfg())
    assert state.open_orders_error
    assert [b["kind"] for b in state.entry_blocks] == ["open_orders_unreadable"]


def test_orders_are_not_listed_at_all_while_the_market_is_closed():
    """Nothing can be submitted, so the listing is pointless — and its failure must not
    manufacture a block on a cycle that was never going to trade."""
    trading = FakeTradingClient(market_open=False, orders_error=RuntimeError("boom"))
    state = gather_account_state(_clients(trading), _cfg())
    assert state.market_open is False
    assert state.open_orders == []
    assert state.open_orders_error == ""
    assert state.entry_blocks == []


# ── exits ────────────────────────────────────────────────────────────────────


def test_an_open_spread_is_measured_against_the_exit_rules_every_cycle():
    state = gather_account_state(
        _clients(
            _paired_spread(), quotes={SHORT: FakeQuote(1.00, 1.10), LONG: FakeQuote(0.20, 0.30)}
        ),
        _cfg(),
    )
    assert len(state.exit_evaluations) == 1
    assert state.exit_evaluations[0].reason


def test_a_spread_deep_in_profit_triggers_its_exit():
    state = gather_account_state(
        _clients(
            _paired_spread(), quotes={SHORT: FakeQuote(0.20, 0.25), LONG: FakeQuote(0.02, 0.05)}
        ),
        _cfg(),
    )
    assert state.triggered_exits, "expected the profit target to fire"


def test_unquotable_legs_do_not_kill_the_cycle():
    """The P/L rules cannot fire without a mark; the cycle carries on and the ITM rule
    still can."""
    state = gather_account_state(
        _clients(_paired_spread(), quotes_error=RuntimeError("no quotes")), _cfg()
    )
    assert len(state.exit_evaluations) == 1
    assert state.open_spreads
