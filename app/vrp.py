"""Volatility risk premium (VRP) per expiry tenor.

The core of the project: before selling premium, measure the edge instead of assuming it.
For each tenor on the ladder we take the ATM implied volatility and subtract the underlying's
20-day realized volatility; the difference, in annualized volatility points, is the premium
on offer. A tenor is tradable only if that premium clears the configured threshold. If no
tenor clears it, the agent does not trade and says so (rule R8).

Why the 1-7 DTE tenors were dropped and why we scan 7-45 instead: the VRP is wider at
60-90 days, standard at 30, and small and unstable at 1-7 days — in event-free windows the
short-dated VRP can be ~zero or negative because short IV is dominated by event jump premium.
See docs/strategy.md A2 / A3 / R1.
"""

from __future__ import annotations

from dataclasses import dataclass

from alpaca.data.models.snapshots import OptionsSnapshot

from app.market.term_structure import atm_iv_for_expiry


@dataclass(frozen=True)
class TenorVrp:
    dte: int
    atm_iv: float | None  # fraction (0.162 == 16.2%)
    vrp_vs_rv20: float | None  # annualized volatility points (atm_iv - rv20), *100
    passes_threshold: bool


def vrp_points(atm_iv: float, rv20: float) -> float:
    """VRP in annualized volatility points. Inputs are fractions; output is percentage
    points (IV 0.162 vs RV 0.134 -> 2.8)."""
    return (atm_iv - rv20) * 100


def scan_tenors(
    snapshots: dict[str, OptionsSnapshot],
    dte_ladder: list[int],
    today_ordinal: int,
    underlying_last: float,
    rv20: float | None,
    threshold_vol_points: float,
    strike_tolerance_pct: float,
) -> list[TenorVrp]:
    """VRP for every tenor on the ladder. `rv20` None (not enough price history) yields
    `atm_iv` populated but `vrp_vs_rv20` None and `passes_threshold` False everywhere —
    without realized vol there is no measured edge, so nothing is tradable."""
    results: list[TenorVrp] = []
    for dte in dte_ladder:
        atm_iv = atm_iv_for_expiry(
            snapshots,
            target_dte=dte,
            today_ordinal=today_ordinal,
            underlying_last=underlying_last,
            strike_tolerance_pct=strike_tolerance_pct,
        )
        if atm_iv is None or rv20 is None:
            results.append(TenorVrp(dte=dte, atm_iv=atm_iv, vrp_vs_rv20=None, passes_threshold=False))
            continue
        vrp = vrp_points(atm_iv, rv20)
        results.append(
            TenorVrp(
                dte=dte,
                atm_iv=atm_iv,
                vrp_vs_rv20=vrp,
                passes_threshold=vrp >= threshold_vol_points,
            )
        )
    return results


def best_tradable_tenor(tenors: list[TenorVrp]) -> TenorVrp | None:
    """The tenor with the highest VRP among those that clear the threshold, or None."""
    passing = [t for t in tenors if t.passes_threshold and t.vrp_vs_rv20 is not None]
    if not passing:
        return None
    # `passes_threshold` already excluded the None VRPs; restate it so the key is total.
    return max(passing, key=lambda t: t.vrp_vs_rv20 or 0.0)
