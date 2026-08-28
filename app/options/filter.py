"""Cut an option chain down to what's actually relevant before anything reaches the LLM.

The LLM runs on OpenRouter free models, whose rate limits come from shared upstream pools
(see the project notes). A full SPY chain snapshot is easily thousands of contracts; sending that to
the model every cycle would blow through those limits in a handful of calls. This filters to
contracts whose short-leg delta falls in the strategy's target band.
"""

from __future__ import annotations

from dataclasses import dataclass

from alpaca.data.models.snapshots import OptionsSnapshot


@dataclass(frozen=True)
class RelevantContract:
    symbol: str
    implied_volatility: float | None
    delta: float
    gamma: float
    theta: float
    vega: float


def filter_relevant_contracts(
    snapshots: dict[str, OptionsSnapshot],
    delta_min: float,
    delta_max: float,
) -> list[RelevantContract]:
    """Keep only contracts whose delta magnitude falls in [delta_min, delta_max].

    Uses `abs(delta)` since puts carry negative delta but the strategy's delta band
    (short_leg_delta_min/max in config/strategy.yaml) is expressed as a magnitude.
    Contracts with no Greeks data are dropped — no Greeks means no defined risk, and this
    strategy never trades without a known delta.
    """
    out: list[RelevantContract] = []
    for symbol, snapshot in snapshots.items():
        if snapshot.greeks is None:
            continue
        magnitude = abs(snapshot.greeks.delta)
        if delta_min <= magnitude <= delta_max:
            out.append(
                RelevantContract(
                    symbol=symbol,
                    implied_volatility=snapshot.implied_volatility,
                    delta=snapshot.greeks.delta,
                    gamma=snapshot.greeks.gamma,
                    theta=snapshot.greeks.theta,
                    vega=snapshot.greeks.vega,
                )
            )
    return out
