"""IV rank: where current implied volatility sits within its own recent range.

Alpaca's market data API has no historical-IV endpoint (option bars are OHLCV price bars,
not volatility series — see the local reference index "Known gaps"). A real IV rank needs a
history of daily IV observations, which this agent builds up itself over time by persisting
each cycle's reading. This module is intentionally just the math: it takes whatever history
is available and is honest when there isn't enough of it yet, rather than fabricating a
number from a single data point.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class IVRankResult:
    rank: float | None  # 0-100 percentile of current_iv within history; None if no history
    history_points: int
    lookback_days: int

    @property
    def has_sufficient_history(self) -> bool:
        return self.history_points >= self.lookback_days


def compute_iv_rank(
    history: list[float], current_iv: float, lookback_days: int
) -> IVRankResult:
    """Standard IV Rank formula: (current - min) / (max - min) * 100, over `history`.

    `history` should already be scoped to the lookback window by the caller (this function
    does no date filtering). Returns rank=None when there's no history at all yet.
    """
    if not history:
        return IVRankResult(rank=None, history_points=0, lookback_days=lookback_days)

    lo, hi = min(history), max(history)
    if hi == lo:
        # No variation in the observed window — rank is undefined in the usual sense.
        rank = 0.0
    else:
        rank = (current_iv - lo) / (hi - lo) * 100

    return IVRankResult(
        rank=rank, history_points=len(history), lookback_days=lookback_days
    )
