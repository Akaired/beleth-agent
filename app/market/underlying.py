"""Underlying (SPY/QQQ) price inputs from Alpaca stock market data — daily closes for the
realized-volatility calculation, and the latest trade price for "at the money" strike
selection. Read-only."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from alpaca.data.enums import Adjustment
from alpaca.data.historical.stock import StockHistoricalDataClient
from alpaca.data.requests import StockBarsRequest, StockLatestTradeRequest
from alpaca.data.timeframe import TimeFrame, TimeFrameUnit


def fetch_daily_closes(
    client: StockHistoricalDataClient, symbol: str, lookback_days: int
) -> list[float]:
    """Adjusted daily closes for `symbol`, oldest first, over roughly the last
    `lookback_days` calendar days.

    Calendar days, not trading days: we over-fetch (weekends/holidays are absent from the
    response) so the caller reliably has enough returns for its longest realized-vol window.
    Split/dividend adjusted so a corporate action doesn't masquerade as a price jump.
    """
    start = datetime.now(timezone.utc) - timedelta(days=lookback_days)
    request = StockBarsRequest(
        symbol_or_symbols=symbol,
        timeframe=TimeFrame(1, TimeFrameUnit.Day),
        start=start,
        adjustment=Adjustment.ALL,
    )
    barset = client.get_stock_bars(request)
    bars = barset.data.get(symbol, [])
    return [bar.close for bar in bars]


def fetch_last_price(client: StockHistoricalDataClient, symbol: str) -> float:
    request = StockLatestTradeRequest(symbol_or_symbols=symbol)
    latest = client.get_stock_latest_trade(request)
    return latest[symbol].price
