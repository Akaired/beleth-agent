"""Option chain retrieval, scoped to the expiry window the strategy actually cares about."""

from __future__ import annotations

from datetime import date, timedelta

from alpaca.data.historical.option import OptionHistoricalDataClient
from alpaca.data.models.snapshots import OptionsSnapshot
from alpaca.data.requests import OptionChainRequest


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
