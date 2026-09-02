"""Alpaca client wiring — paper trading only.

`paper=True` is hardcoded below, never read from config or an env var: whether the trading
client can ever touch a live endpoint must not be a flag anyone can flip.
"""

from __future__ import annotations

from typing import Any, TypeVar

from alpaca.common.enums import BaseURL
from alpaca.data.historical.option import OptionHistoricalDataClient
from alpaca.data.historical.stock import StockHistoricalDataClient
from alpaca.trading.client import TradingClient
from alpaca.trading.models import Clock, Order, Position, TradeAccount

from app.config import Settings

_Model = TypeVar("_Model")


def model_response(value: _Model | dict[str, Any]) -> _Model:
    """Narrow alpaca-py's ``Model | RawData`` return type to the model.

    Every alpaca-py read is typed as a union because a client *can* be built with
    ``raw_data=True``; none of ours is, so the dict arm is unreachable. Saying that once,
    here, is honest — scattering ``# type: ignore`` over the call sites is not.
    """
    if isinstance(value, dict):
        raise TypeError("alpaca client returned raw data — this project never sets raw_data=True")
    return value


def money(value: str | float | None, field: str) -> float:
    """Coerce an Alpaca money field to a float, failing loudly instead of on ``None``.

    Alpaca types every money field as an optional string. ``float(None)`` would raise a
    bare ``TypeError`` deep inside a cycle; this names the field that was missing.
    """
    if value is None:
        raise ValueError(f"Alpaca returned no value for {field!r}")
    return float(value)


def fetch_account(client: TradingClient) -> TradeAccount:
    return model_response(client.get_account())


def fetch_positions(client: TradingClient) -> list[Position]:
    return model_response(client.get_all_positions())


def fetch_clock(client: TradingClient) -> Clock:
    return model_response(client.get_clock())


def fetch_order(client: TradingClient, order_id: str, **kwargs: Any) -> Order:
    return model_response(client.get_order_by_id(order_id, **kwargs))


def get_trading_client(settings: Settings) -> TradingClient:
    return TradingClient(
        api_key=settings.alpaca_api_key,
        secret_key=settings.alpaca_secret_key,
        paper=True,
    )


def get_option_data_client(settings: Settings) -> OptionHistoricalDataClient:
    return OptionHistoricalDataClient(
        api_key=settings.alpaca_api_key,
        secret_key=settings.alpaca_secret_key,
    )


def get_stock_data_client(settings: Settings) -> StockHistoricalDataClient:
    """Historical stock bars — used only to compute the underlying's realized volatility
    and read its last price. Read-only market data, no trading surface."""
    return StockHistoricalDataClient(
        api_key=settings.alpaca_api_key,
        secret_key=settings.alpaca_secret_key,
    )


class NotPaperAccountError(RuntimeError):
    """Raised if a trading client somehow isn't pointed at the paper endpoint."""


def assert_paper_trading(client: TradingClient) -> None:
    """Verify the client is actually talking to the paper endpoint, not just configured to.

    `TradingClient(paper=True)` resolves internally to `BaseURL.TRADING_PAPER`. This check
    exists so a future refactor can't silently break constraint #1 (paper trading only)
    without a loud, explicit failure.
    """
    if client._base_url != BaseURL.TRADING_PAPER:
        raise NotPaperAccountError(
            f"Trading client is not pointed at the paper endpoint (got {client._base_url!r}). "
            "Refusing to proceed — this project is paper-trading only."
        )


def describe_account(account: TradeAccount) -> str:
    return (
        f"account_number={account.account_number} status={account.status} "
        f"currency={account.currency} cash={account.cash} "
        f"buying_power={account.buying_power} "
        f"options_approved_level={account.options_approved_level} "
        f"options_trading_level={account.options_trading_level}"
    )
