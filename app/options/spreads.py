"""Mechanical construction of defined-risk vertical spread candidates from a chain snapshot.

This is *candidate generation*, not trade selection: it turns raw contracts into a short
list of well-formed vertical spreads with their max loss, credit, and breakeven already
computed, so the evidence package carries concrete structures rather than a raw chain. The
LLM decision layer chooses whether and which to trade on top of this list.

Every candidate here is a single two-leg vertical: short one option in the target delta band,
long one further out of the money by the configured strike width. Max loss is bounded to
``width - credit`` by construction — never a naked leg. See docs/strategy.md R4.
"""

from __future__ import annotations

from dataclasses import dataclass

from alpaca.data.models.snapshots import OptionsSnapshot

from app.occ import InvalidOccSymbolError, parse_occ_symbol

CONTRACT_MULTIPLIER = 100


@dataclass(frozen=True)
class _Leg:
    symbol: str
    strike: float
    right: str
    delta: float
    bid: float | None
    ask: float | None

    @property
    def mid(self) -> float | None:
        if self.bid is None or self.ask is None or self.ask <= 0:
            return None
        return (self.bid + self.ask) / 2

    @property
    def quote_width(self) -> float | None:
        if self.bid is None or self.ask is None:
            return None
        return self.ask - self.bid


@dataclass(frozen=True)
class SpreadCandidate:
    symbol: str  # underlying
    right: str  # "P" (bull put spread) or "C" (bear call spread)
    expiry: str  # ISO date
    dte: int
    short_strike: float
    long_strike: float
    strike_width: float
    delta_short: float
    credit: float | None  # net credit per share (mid-based)
    max_loss: float | None  # per one-contract spread, in dollars
    breakeven: float | None
    net_quote_width: float | None  # combined bid/ask width of the two legs, per share
    # The two legs' real OCC contract symbols as they appeared in the chain snapshot —
    # carried through so the order path submits exactly the contracts it measured, and
    # never rebuilds a symbol from (expiry, strike, right).
    short_symbol: str = ""
    long_symbol: str = ""

    def as_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "right": self.right,
            "expiry": self.expiry,
            "dte": self.dte,
            "strikes": [self.short_strike, self.long_strike],
            "strike_width": self.strike_width,
            "delta_short": round(self.delta_short, 4),
            "credit": None if self.credit is None else round(self.credit, 4),
            "max_loss": None if self.max_loss is None else round(self.max_loss, 2),
            "breakeven": None if self.breakeven is None else round(self.breakeven, 4),
            "bid_ask_spread": None
            if self.net_quote_width is None
            else round(self.net_quote_width, 4),
            "short_symbol": self.short_symbol,
            "long_symbol": self.long_symbol,
        }


def _legs_for_nearest_expiry(
    snapshots: dict[str, OptionsSnapshot], target_dte: int, today_ordinal: int
) -> tuple[int, str, list[_Leg]] | None:
    by_dte: dict[int, list[_Leg]] = {}
    for symbol, snap in snapshots.items():
        if snap.greeks is None:
            continue
        try:
            occ = parse_occ_symbol(symbol)
        except InvalidOccSymbolError:
            continue
        dte = occ.expiry.toordinal() - today_ordinal
        if dte < 0:
            continue
        quote = snap.latest_quote
        by_dte.setdefault(dte, []).append(
            _Leg(
                symbol=symbol,
                strike=occ.strike,
                right=occ.right,
                delta=snap.greeks.delta,
                bid=getattr(quote, "bid_price", None) if quote else None,
                ask=getattr(quote, "ask_price", None) if quote else None,
            )
        )
    if not by_dte:
        return None
    chosen = min(by_dte, key=lambda d: abs(d - target_dte))
    expiry_iso = _expiry_iso(chosen, today_ordinal)
    return chosen, expiry_iso, by_dte[chosen]


def _expiry_iso(dte: int, today_ordinal: int) -> str:
    from datetime import date

    return date.fromordinal(today_ordinal + dte).isoformat()


def _build_one_side(
    underlying: str,
    right: str,
    legs: list[_Leg],
    dte: int,
    expiry_iso: str,
    delta_min: float,
    delta_max: float,
    width_min: float,
    width_max: float,
) -> SpreadCandidate | None:
    same_right = [leg for leg in legs if leg.right == right]
    in_band = [leg for leg in same_right if delta_min <= abs(leg.delta) <= delta_max]
    if not in_band:
        return None

    band_mid = (delta_min + delta_max) / 2
    short_leg = min(in_band, key=lambda leg: abs(abs(leg.delta) - band_mid))

    # Long leg: further OTM. For puts that's a lower strike, for calls a higher strike.
    if right == "P":
        protective = [leg for leg in same_right if leg.strike < short_leg.strike]
    else:
        protective = [leg for leg in same_right if leg.strike > short_leg.strike]
    if not protective:
        return None

    def width_of(leg: _Leg) -> float:
        return abs(short_leg.strike - leg.strike)

    within_width = [leg for leg in protective if width_min <= width_of(leg) <= width_max]
    pool = within_width or protective
    long_leg = min(pool, key=lambda leg: abs(width_of(leg) - width_min))

    strike_width = width_of(long_leg)

    credit: float | None = None
    if short_leg.mid is not None and long_leg.mid is not None:
        credit = short_leg.mid - long_leg.mid

    max_loss: float | None = None
    breakeven: float | None = None
    if credit is not None:
        max_loss = (strike_width - credit) * CONTRACT_MULTIPLIER
        if right == "P":
            breakeven = short_leg.strike - credit
        else:
            breakeven = short_leg.strike + credit

    net_quote_width: float | None = None
    if short_leg.quote_width is not None and long_leg.quote_width is not None:
        net_quote_width = short_leg.quote_width + long_leg.quote_width

    return SpreadCandidate(
        symbol=underlying,
        right=right,
        expiry=expiry_iso,
        dte=dte,
        short_strike=short_leg.strike,
        long_strike=long_leg.strike,
        strike_width=strike_width,
        delta_short=short_leg.delta,
        credit=credit,
        max_loss=max_loss,
        breakeven=breakeven,
        net_quote_width=net_quote_width,
        short_symbol=short_leg.symbol,
        long_symbol=long_leg.symbol,
    )


def build_candidates(
    snapshots: dict[str, OptionsSnapshot],
    underlying: str,
    target_dtes: list[int],
    today_ordinal: int,
    delta_min: float,
    delta_max: float,
    width_min: float,
    width_max: float,
) -> list[SpreadCandidate]:
    """One bull-put and one bear-call vertical per requested tenor, where the chain supports
    a well-formed structure. `target_dtes` is normally the tenors that cleared the VRP
    threshold; pass the whole ladder to see everything."""
    out: list[SpreadCandidate] = []
    seen: set[tuple[int, str]] = set()
    for target in target_dtes:
        found = _legs_for_nearest_expiry(snapshots, target, today_ordinal)
        if found is None:
            continue
        dte, expiry_iso, legs = found
        for right in ("P", "C"):
            if (dte, right) in seen:
                continue
            seen.add((dte, right))
            candidate = _build_one_side(
                underlying, right, legs, dte, expiry_iso,
                delta_min, delta_max, width_min, width_max,
            )
            if candidate is not None:
                out.append(candidate)
    return out
