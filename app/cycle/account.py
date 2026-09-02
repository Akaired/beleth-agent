"""Reading the account: what is open, what it is worth, what it may still risk.

The one thing worth stating plainly is why the underlying price is fetched per spread
rather than once per cycle. The short-leg ITM exit rule compares a spread's short strike
against its *own* symbol's price. A QQQ cycle measuring an SPY spread against QQQ's
price would misread in-the-money and could fire a spurious close — so the price is
looked up per distinct root, and a failed lookup disables only the ITM rule for that
symbol rather than the whole exit path.
"""

from __future__ import annotations

import sys
from typing import Any

from app.market.underlying import fetch_last_price
from app.redact import describe_exception


def _underlying_prices_for_spreads(
    stock_client: Any, spreads: list[Any]
) -> dict[str, float | None]:
    """Last price of each spread's OWN underlying, one fetch per distinct symbol.

    The short-leg ITM rule compares a spread's short strike against its own symbol's
    price — never the cycle's symbol: a QQQ cycle measuring an SPY spread against
    QQQ's price would misread ITM/OTM and could trigger a spurious close. A failed
    quote only disables the ITM rule for that symbol (fail-safe, not fail-spurious);
    the P/L rules keep working off the leg quotes.
    """
    prices: dict[str, float | None] = {}
    for spread in spreads:
        root = spread.root
        if root in prices:
            continue
        try:
            prices[root] = fetch_last_price(stock_client, root)
        except Exception as exc:  # noqa: BLE001 — see docstring: ITM rule off, nothing worse
            prices[root] = None
            print(
                f"WARNING: last price for {root} unavailable "
                f"({describe_exception(exc)}) — its short-leg ITM exit rule "
                "cannot fire this cycle.",
                file=sys.stderr,
            )
    return prices
