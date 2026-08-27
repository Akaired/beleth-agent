"""Term structure of implied volatility, derived from the SPY option chain itself.

We have no VIX futures, so the regime gate can't use the usual VIX term structure. Instead
we approximate it from the chain we already fetch: ATM implied volatility at a short tenor
vs. a long tenor.

    short ATM IV  <  long ATM IV   -> contango       (normal)
    short ATM IV  >  long ATM IV   -> backwardation  (stress)
    |short - long| within a flat band -> flat

Backwardation is a statistically significant stress signal; contango is not — so this feeds
rule R2 (block new premium selling on backwardation) and nothing is built on contango. See
docs/strategy.md A5.
"""

from __future__ import annotations

from dataclasses import dataclass

from alpaca.data.models.snapshots import OptionsSnapshot

from app.occ import InvalidOccSymbolError, parse_occ_symbol

CONTANGO = "contango"
BACKWARDATION = "backwardation"
FLAT = "flat"


@dataclass(frozen=True)
class TermStructure:
    state: str  # CONTANGO | BACKWARDATION | FLAT
    short_atm_iv: float | None
    long_atm_iv: float | None
    short_dte: int
    long_dte: int


def atm_iv_for_expiry(
    snapshots: dict[str, OptionsSnapshot],
    target_dte: int,
    today_ordinal: int,
    underlying_last: float,
    strike_tolerance_pct: float,
) -> float | None:
    """Implied volatility of the contract closest to the money at whichever available expiry
    is nearest to `target_dte`.

    `today_ordinal` is `date.today().toordinal()` — passed in so callers can pin "today"
    and keep this function pure. Averages the call and put IV at the chosen strike when both
    are present (they rarely match exactly and neither is more "correct" for a regime read).
    Returns None if nothing within the strike tolerance carries IV.
    """
    by_expiry: dict[int, list[tuple[float, str, float]]] = {}
    for symbol, snap in snapshots.items():
        if snap.implied_volatility is None:
            continue
        try:
            occ = parse_occ_symbol(symbol)
        except InvalidOccSymbolError:
            continue
        dte = occ.expiry.toordinal() - today_ordinal
        if dte < 0:
            continue
        by_expiry.setdefault(dte, []).append(
            (occ.strike, occ.right, snap.implied_volatility)
        )

    if not by_expiry:
        return None

    chosen_dte = min(by_expiry, key=lambda d: abs(d - target_dte))
    contracts = by_expiry[chosen_dte]

    tol = underlying_last * strike_tolerance_pct / 100
    near_money = [c for c in contracts if abs(c[0] - underlying_last) <= tol]
    pool = near_money or contracts
    best_strike = min(pool, key=lambda c: abs(c[0] - underlying_last))[0]

    ivs = [iv for (strike, _right, iv) in pool if strike == best_strike]
    if not ivs:
        return None
    return sum(ivs) / len(ivs)


def classify(
    short_atm_iv: float | None,
    long_atm_iv: float | None,
    short_dte: int,
    long_dte: int,
    flat_band_iv: float,
) -> TermStructure:
    if short_atm_iv is None or long_atm_iv is None:
        return TermStructure(FLAT, short_atm_iv, long_atm_iv, short_dte, long_dte)

    diff = short_atm_iv - long_atm_iv
    if abs(diff) <= flat_band_iv:
        state = FLAT
    elif diff < 0:
        state = CONTANGO
    else:
        state = BACKWARDATION
    return TermStructure(state, short_atm_iv, long_atm_iv, short_dte, long_dte)
