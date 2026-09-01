"""Alpaca client wiring — paper trading only.

`paper=True` is hardcoded below, never read from config or an env var: whether the trading
client can ever touch a live endpoint must not be a flag anyone can flip.
"""

from __future__ import annotations

from alpaca.common.enums import BaseURL
from alpaca.data.historical.option import OptionHistoricalDataClient
from alpaca.data.historical.stock import StockHistoricalDataClient
from alpaca.trading.client import TradingClient
from alpaca.trading.models import TradeAccount

from app.config import Settings


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
