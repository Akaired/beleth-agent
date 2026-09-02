"""Fakes for the trading cycle's outside world.

`scripts/check_market_data.py` is not a diagnostic script: it is the cycle the resident
runner launches for every symbol, every five minutes, in production. It had no
end-to-end coverage at all — only its extracted helpers were tested.

These fakes stand in for the *edges* and nothing else: the three Alpaca SDK clients, the
VIX HTTP fetch, the LLM transport and the Supabase request funnel. Everything between
them — the chain filtering, the VRP scan, the risk gate, the exit rules, the order
construction, the evidence package — is the real code under test.

The seams are chosen to survive a refactor of the cycle itself: they are attributes of
modules the cycle does not own, so a test written against them keeps working when the
cycle's own functions move.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from typing import Any

# ── option-chain shapes ──────────────────────────────────────────────────────


@dataclass
class FakeGreeks:
    delta: float


@dataclass
class FakeQuote:
    bid_price: float | None
    ask_price: float | None


@dataclass
class FakeSnapshot:
    greeks: FakeGreeks | None = None
    latest_quote: FakeQuote | None = None
    implied_volatility: float | None = None


def occ(expiry: date, right: str, strike: float, root: str = "SPY") -> str:
    """An OCC-21 symbol, the same construction `app.occ` parses."""
    return f"{root}{expiry:%y%m%d}{right}{round(strike * 1000):08d}"


def put_credit_chain(
    *,
    today: date,
    dtes: list[int],
    underlying_last: float = 450.0,
    iv_by_dte: dict[int, float] | None = None,
    root: str = "SPY",
) -> dict[str, FakeSnapshot]:
    """A chain rich enough to build a short put vertical at every listed tenor.

    Strikes are placed around `underlying_last` with deltas that put the short leg inside
    the strategy's 0.15-0.25 band and the long leg below it, and quotes that leave a
    credit wide enough to clear the slippage cap.
    """
    iv_by_dte = iv_by_dte or {}
    chain: dict[str, FakeSnapshot] = {}
    for dte in dtes:
        expiry = today + timedelta(days=dte)
        iv = iv_by_dte.get(dte, 0.22)
        atm = round(underlying_last)
        # At the money, for the term-structure and VRP readings.
        chain[occ(expiry, "C", atm, root)] = FakeSnapshot(
            FakeGreeks(0.50), FakeQuote(5.00, 5.10), iv
        )
        chain[occ(expiry, "P", atm, root)] = FakeSnapshot(
            FakeGreeks(-0.50), FakeQuote(5.00, 5.10), iv
        )
        # The tradable band: a 0.20-delta short put, protection 5 points below.
        chain[occ(expiry, "P", atm - 10, root)] = FakeSnapshot(
            FakeGreeks(-0.20), FakeQuote(1.60, 1.70), iv
        )
        chain[occ(expiry, "P", atm - 15, root)] = FakeSnapshot(
            FakeGreeks(-0.10), FakeQuote(0.60, 0.70), iv
        )
    return chain


# ── Alpaca SDK clients ───────────────────────────────────────────────────────


class FakeTradingClient:
    """Stands in for `alpaca.trading.client.TradingClient`.

    Records every submitted and cancelled order so a test can assert on the order path
    without a broker.
    """

    def __init__(
        self,
        *,
        equity: float = 100_000.0,
        last_equity: float = 100_000.0,
        cash: float = 100_000.0,
        buying_power: float = 200_000.0,
        positions: list[Any] | None = None,
        market_open: bool = True,
        open_orders: list[Any] | None = None,
        orders_error: Exception | None = None,
        submit_error: Exception | None = None,
    ) -> None:
        # `assert_paper_trading` reads this; the factory refuses anything else.
        from alpaca.common.enums import BaseURL

        self._base_url = BaseURL.TRADING_PAPER
        self._session: Any = None
        self._account = SimpleNamespace(
            equity=str(equity),
            last_equity=str(last_equity),
            cash=str(cash),
            buying_power=str(buying_power),
            account_number="PA-TEST",
            status="ACTIVE",
            currency="USD",
            options_approved_level=3,
            options_trading_level=3,
        )
        self._positions = positions or []
        self._clock = SimpleNamespace(
            is_open=market_open,
            next_open=datetime.now(UTC) + timedelta(hours=1),
            next_close=datetime.now(UTC) + timedelta(hours=6),
        )
        self._open_orders = open_orders or []
        self._orders_error = orders_error
        self._submit_error = submit_error
        self.submitted: list[Any] = []
        self.cancelled: list[str] = []

    def get_account(self) -> Any:
        return self._account

    def get_all_positions(self) -> list[Any]:
        return self._positions

    def get_clock(self) -> Any:
        return self._clock

    def get_orders(self, _request: Any = None) -> list[Any]:
        if self._orders_error is not None:
            raise self._orders_error
        return list(self._open_orders)

    def cancel_order_by_id(self, order_id: str) -> None:
        self.cancelled.append(str(order_id))

    def submit_order(self, request: Any) -> Any:
        if self._submit_error is not None:
            raise self._submit_error
        self.submitted.append(request)
        fields = request.to_request_fields() if hasattr(request, "to_request_fields") else {}
        return SimpleNamespace(
            model_dump=lambda mode="json": {
                "id": f"order-{len(self.submitted)}",
                "status": "accepted",
                "client_order_id": fields.get("client_order_id"),
                "legs": fields.get("legs", []),
            }
        )


class FakeStockClient:
    """Stands in for `StockHistoricalDataClient` — daily closes and the last trade."""

    def __init__(self, *, last_price: float = 450.0, closes: list[float] | None = None) -> None:
        self.last_price = last_price
        # A gently trending series: enough points for the longest realized-vol window,
        # with real variation so the vol is neither zero nor absurd.
        self.closes = closes or [440.0 + (i % 7) * 0.9 + i * 0.05 for i in range(260)]

    def get_stock_bars(self, _request: Any) -> Any:
        bars = [SimpleNamespace(close=c) for c in self.closes]
        return SimpleNamespace(data=dict.fromkeys(("SPY", "QQQ"), bars))

    def get_stock_latest_trade(self, _request: Any) -> Any:
        price = self.last_price
        return _Defaulting(lambda _sym: SimpleNamespace(price=price))


class _Defaulting(dict):
    """A mapping that answers any key — the SDK returns one keyed by symbol."""

    def __init__(self, make: Any) -> None:
        super().__init__()
        self._make = make

    def __getitem__(self, key: str) -> Any:
        return self._make(key)


class FakeOptionClient:
    """Stands in for `OptionHistoricalDataClient` — the chain and per-leg quotes."""

    def __init__(
        self,
        chain: dict[str, FakeSnapshot],
        *,
        quotes: dict[str, FakeQuote] | None = None,
        quotes_error: Exception | None = None,
    ) -> None:
        self.chain = chain
        self.quotes = quotes or {}
        self.quotes_error = quotes_error

    def get_option_chain(self, _request: Any) -> dict[str, FakeSnapshot]:
        return self.chain

    def get_option_latest_quote(self, request: Any) -> dict[str, FakeQuote]:
        if self.quotes_error is not None:
            raise self.quotes_error
        wanted = request.symbol_or_symbols
        symbols = [wanted] if isinstance(wanted, str) else list(wanted)
        return {s: self.quotes[s] for s in symbols if s in self.quotes}


# ── VIX ──────────────────────────────────────────────────────────────────────


def fred_csv(*, days: int = 300, level: float = 18.0) -> str:
    """A FRED `VIXCLS` CSV with a flat-ish history, newest last."""
    start = date(2026, 1, 1)
    rows = ["observation_date,VIXCLS"]
    for i in range(days):
        rows.append(f"{start + timedelta(days=i)},{level + (i % 5) * 0.1:.2f}")
    return "\n".join(rows)


# ── Supabase ─────────────────────────────────────────────────────────────────


@dataclass
class RecordedRequest:
    method: str
    table: str | None
    json_body: Any = None
    params: Any = None


@dataclass
class FakeSupabase:
    """Replaces `app.persistence._request`, the single funnel every write passes through.

    Keeps an ordered log, which is what lets a test assert that the decision row was
    written *before* any order was submitted.
    """

    calls: list[RecordedRequest] = field(default_factory=list)
    fail_on_table: str | None = None

    def __call__(
        self,
        _config: Any,
        method: str,
        table: str | None,
        *,
        params: Any = None,
        json_body: Any = None,
        prefer: str | None = None,
    ) -> Any:
        self.calls.append(RecordedRequest(method, table, json_body, params))
        if self.fail_on_table is not None and table == self.fail_on_table:
            from app.persistence import PersistenceRequestError

            raise PersistenceRequestError(f"fake failure writing {table}")
        return []

    def rows(self, table: str, method: str = "POST") -> list[Any]:
        out: list[Any] = []
        for call in self.calls:
            if call.table == table and call.method == method and call.json_body:
                out.extend(call.json_body if isinstance(call.json_body, list) else [call.json_body])
        return out

    def tables(self) -> list[str | None]:
        return [c.table for c in self.calls]


# ── LLM ──────────────────────────────────────────────────────────────────────


def llm_response(
    *, action: str, candidate_index: int = 0, reasoning: str = "fake reasoning"
) -> Any:
    """One `submit_decision` tool call, the shape `app.decision` consumes."""
    args: dict[str, Any] = {"action": action, "reasoning": reasoning}
    if action == "trade":
        args["candidate_index"] = candidate_index
    return SimpleNamespace(
        choices=[
            SimpleNamespace(
                message=SimpleNamespace(
                    content=None,
                    tool_calls=[
                        SimpleNamespace(
                            id="call_1",
                            function=SimpleNamespace(
                                name="submit_decision", arguments=json.dumps(args)
                            ),
                        )
                    ],
                )
            )
        ],
        usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5, total_tokens=15),
    )


def scripted_llm(*responses: Any) -> Any:
    """A `complete_fn` that replays `responses` in order and then repeats the last."""
    queue = list(responses)

    def complete(_settings: Any, _messages: Any, **_kwargs: Any) -> Any:
        return queue.pop(0) if len(queue) > 1 else queue[0]

    return complete


# ── open positions ───────────────────────────────────────────────────────────


def position(symbol: str, qty: float, avg_entry_price: float, side: str) -> Any:
    """One Alpaca option position, as the cycle dumps it (`model_dump(mode="json")`)."""
    dump = {
        "symbol": symbol,
        "qty": str(qty),
        "side": side,
        "avg_entry_price": str(avg_entry_price),
        "asset_class": "us_option",
        "market_value": "0",
        "cost_basis": "0",
        "unrealized_pl": "0",
    }
    return SimpleNamespace(model_dump=lambda mode="json": dict(dump))
