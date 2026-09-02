"""Option chain retrieval, scoped to the expiry window the strategy actually cares about."""

from __future__ import annotations

from datetime import date, timedelta

from alpaca.data.historical.option import OptionHistoricalDataClient
from alpaca.data.models.snapshots import OptionsSnapshot
from alpaca.data.requests import OptionChainRequest, OptionLatestQuoteRequest


def fetch_chain(
    client: OptionHistoricalDataClient,
    underlying_symbol: str,
    expiry_days_min: int,
    expiry_days_max: int,
) -> dict[str, OptionsSnapshot]:
    """Fetch the option chain for `underlying_symbol`, pre-filtered server-side to the
    expiry window `[today + expiry_days_min, today + expiry_days_max]`.

    Delta/liquidity filtering happens later (see `app.options.filter`) — Alpaca's chain
    endpoint doesn't support filtering by Greeks directly.
    """
    today = date.today()
    request = OptionChainRequest(
        underlying_symbol=underlying_symbol,
        expiration_date_gte=today + timedelta(days=expiry_days_min),
        expiration_date_lte=today + timedelta(days=expiry_days_max),
    )
    return client.get_option_chain(request)


def fetch_chain_for_ladder(
    client: OptionHistoricalDataClient,
    underlying_symbol: str,
    dte_ladder: list[int],
    tail_days: int = 3,
) -> dict[str, OptionsSnapshot]:
    """Fetch one chain wide enough to cover every tenor on the scan ladder.

    The agent no longer has a fixed expiry — it scans a ladder of DTEs (see
    `config/strategy.yaml` `tenor_scan.dte_ladder`) and trades only the tenor whose VRP
    clears the threshold. `tail_days` widens the window a little past the longest ladder
    tenor so the nearest listed expiry to it is still in range.
    """
    lo = max(0, min(dte_ladder) - tail_days)
    hi = max(dte_ladder) + tail_days
    return fetch_chain(client, underlying_symbol, expiry_days_min=lo, expiry_days_max=hi)


def fetch_latest_quotes(
    client: OptionHistoricalDataClient, symbols: list[str]
) -> dict[str, tuple[float | None, float | None]]:
    """Latest quote (bid, ask) per option symbol, for pricing exits on open positions.

    Takes explicit OCC symbols — the contracts an open spread actually holds, which may
    sit outside the scan ladder's expiry window and therefore outside any chain fetch.
    Missing or unusable quotes come back as ``(None, None)``; callers treat a missing
    mark as "cannot measure, do not act" (see `app.exits.evaluate_exit`).
    """
    if not symbols:
        return {}
    quotes = client.get_option_latest_quote(OptionLatestQuoteRequest(symbol_or_symbols=symbols))
    out: dict[str, tuple[float | None, float | None]] = {}
    for symbol, quote in quotes.items():
        bid = getattr(quote, "bid_price", None)
        ask = getattr(quote, "ask_price", None)
        out[symbol] = (
            float(bid) if bid is not None else None,
            float(ask) if ask is not None else None,
        )
    return out
