"""Parse OCC option symbols.

Alpaca's option chain snapshots are keyed by the 21-character OCC symbol, e.g.
``SPY260904C00450000``:

    root      up to 6 chars, left-justified (here ``SPY``)
    expiry    6 digits, ``YYMMDD``            (here 2026-09-04)
    right     1 char, ``C`` or ``P``
    strike    8 digits, price * 1000, zero-padded (here 450.000)

The chain endpoint doesn't return expiry/strike as separate fields on the snapshot, so we
recover them from the key. `alpaca-py` has no public helper for this (checked the vendored
SDK source), hence this small module.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date

_OCC_RE = re.compile(
    r"^(?P<root>[A-Z]{1,6})(?P<yy>\d{2})(?P<mm>\d{2})(?P<dd>\d{2})(?P<right>[CP])(?P<strike>\d{8})$"
)


@dataclass(frozen=True)
class OccSymbol:
    raw: str
    root: str
    expiry: date
    right: str  # "C" or "P"
    strike: float


class InvalidOccSymbolError(ValueError):
    """Raised when a string isn't a well-formed OCC option symbol."""


def parse_occ_symbol(symbol: str) -> OccSymbol:
    m = _OCC_RE.match(symbol)
    if m is None:
        raise InvalidOccSymbolError(f"not a valid OCC option symbol: {symbol!r}")
    expiry = date(2000 + int(m["yy"]), int(m["mm"]), int(m["dd"]))
    strike = int(m["strike"]) / 1000
    return OccSymbol(
        raw=symbol,
        root=m["root"],
        expiry=expiry,
        right=m["right"],
        strike=strike,
    )
