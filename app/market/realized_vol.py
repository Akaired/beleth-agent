"""Close-to-close annualized realized volatility, from a series of daily closes.

This is the "RV" side of the volatility risk premium: the volatility the underlying actually
delivered, to compare against the implied volatility the options are pricing (see
`app.vrp`). Standard estimator — log returns, sample standard deviation, annualized by
sqrt(trading days per year).

Pure math: the caller supplies the closes (see `fetch_daily_closes` for the Alpaca side).
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class RealizedVolResult:
    window_days: int
    value: float | None  # annualized, as a fraction (0.134 == 13.4%); None if not enough data
    returns_used: int


def realized_vol(
    closes: list[float], window_days: int, annualization_trading_days: int = 252
) -> RealizedVolResult:
    """Annualized close-to-close realized volatility over the last `window_days` returns.

    `closes` must be in chronological order (oldest first). We need `window_days + 1` closes
    to form `window_days` log returns; with fewer, `value` is None rather than a guess.
    """
    if window_days < 2:
        raise ValueError("window_days must be at least 2")

    needed = window_days + 1
    if len(closes) < needed:
        return RealizedVolResult(window_days=window_days, value=None, returns_used=0)

    recent = closes[-needed:]
    log_returns = [math.log(recent[i] / recent[i - 1]) for i in range(1, len(recent))]

    n = len(log_returns)
    mean = sum(log_returns) / n
    # Sample variance (ddof=1) — matches the convention used by most vol references.
    variance = sum((r - mean) ** 2 for r in log_returns) / (n - 1)
    daily_vol = math.sqrt(variance)
    annualized = daily_vol * math.sqrt(annualization_trading_days)

    return RealizedVolResult(window_days=window_days, value=annualized, returns_used=n)


def realized_vol_for_windows(
    closes: list[float], windows_days: list[int], annualization_trading_days: int = 252
) -> dict[int, RealizedVolResult]:
    return {w: realized_vol(closes, w, annualization_trading_days) for w in windows_days}
