"""VIX regime input, sourced from FRED (not Alpaca).

Alpaca does not provide index data and has stated it has no plans to
(forum.alpaca.markets/t/quotes-for-indices/13743), so there is no VIX or SPX from that
side. We pull the CBOE VIX close series from FRED (series ``VIXCLS``), daily history back to
1990, free, no API key needed for the CSV endpoint. CBOE's own published history is the
fallback if FRED is unreachable.

The VIX is used here as a *regime* measure (its own 1-year percentile) and as a 30-day
premium thermometer — NOT as a proxy for the implied volatility of the contracts we trade.
The VIX is model-independent, includes OTM strikes, embeds skew, and runs systematically
above ATM IV; for per-contract IV we use the contracts' own IV, which Alpaca does provide.
See docs/strategy.md A4.

Per the milestone constraints: if the endpoint doesn't respond or would require a key we
don't have, this raises `VixDataUnavailable` rather than substituting anything.
"""

from __future__ import annotations

import csv
import io
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime

_USER_AGENT = "beleth-agent/0.1 (hackathon paper-trading research)"
_TIMEOUT_SECONDS = 15


class VixDataUnavailable(RuntimeError):
    """Raised when neither FRED nor the configured fallback yields usable VIX history."""


@dataclass(frozen=True)
class VixObservation:
    day: date
    value: float


@dataclass(frozen=True)
class VixRegime:
    level: float  # most recent VIX close
    as_of: date
    percentile_1y: float  # 0-100: share of the lookback window at or below `level`
    rank_1y: float  # 0-100: (level - min) / (max - min) over the lookback window
    lookback_points: int


def _http_get(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:
            if response.status != 200:
                raise VixDataUnavailable(f"{url} returned HTTP {response.status}")
            charset = response.headers.get_content_charset() or "utf-8"
            return response.read().decode(charset)
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise VixDataUnavailable(
                f"{url} requires authentication (HTTP {exc.code}). "
                "We do not register an API key without the user's go-ahead — stopping."
            ) from exc
        raise VixDataUnavailable(f"{url} failed: HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise VixDataUnavailable(f"{url} is unreachable: {exc}") from exc


def _parse_fred_csv(text: str) -> list[VixObservation]:
    """FRED graph CSV: header row ``observation_date,VIXCLS`` (or ``DATE,VIXCLS`` on older
    exports), then ``YYYY-MM-DD,<value>`` rows. Missing values are the literal ``.``."""
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows or len(rows) < 2:
        raise VixDataUnavailable("FRED CSV had no data rows")

    out: list[VixObservation] = []
    for row in rows[1:]:
        if len(row) < 2:
            continue
        raw_date, raw_value = row[0].strip(), row[1].strip()
        if not raw_value or raw_value == ".":
            continue
        try:
            day = datetime.strptime(raw_date, "%Y-%m-%d").date()
            value = float(raw_value)
        except ValueError:
            continue
        out.append(VixObservation(day=day, value=value))

    if not out:
        raise VixDataUnavailable("FRED CSV parsed to zero usable observations")
    out.sort(key=lambda o: o.day)
    return out


def _parse_cboe_csv(text: str) -> list[VixObservation]:
    """CBOE VIX_History.csv: header ``DATE,OPEN,HIGH,LOW,CLOSE`` with ``MM/DD/YYYY`` dates."""
    reader = csv.DictReader(io.StringIO(text))
    out: list[VixObservation] = []
    for row in reader:
        raw_date = (row.get("DATE") or "").strip()
        raw_close = (row.get("CLOSE") or "").strip()
        if not raw_date or not raw_close:
            continue
        try:
            day = datetime.strptime(raw_date, "%m/%d/%Y").date()
            value = float(raw_close)
        except ValueError:
            continue
        out.append(VixObservation(day=day, value=value))
    if not out:
        raise VixDataUnavailable("CBOE CSV parsed to zero usable observations")
    out.sort(key=lambda o: o.day)
    return out


def fetch_vix_history(
    fred_csv_url: str, cboe_fallback_url: str | None = None
) -> list[VixObservation]:
    """VIX daily closes, oldest first. Tries FRED, then the CBOE fallback if given."""
    try:
        return _parse_fred_csv(_http_get(fred_csv_url))
    except VixDataUnavailable as fred_exc:
        if not cboe_fallback_url:
            raise
        try:
            return _parse_cboe_csv(_http_get(cboe_fallback_url))
        except VixDataUnavailable as cboe_exc:
            raise VixDataUnavailable(
                f"FRED failed ({fred_exc}); CBOE fallback also failed ({cboe_exc})"
            ) from cboe_exc


def percentile_of(history: list[float], value: float) -> float:
    """Share of `history` at or below `value`, as 0-100."""
    if not history:
        raise ValueError("history is empty")
    at_or_below = sum(1 for h in history if h <= value)
    return at_or_below / len(history) * 100


def rank_of(history: list[float], value: float) -> float:
    """(value - min) / (max - min) over `history`, as 0-100. Same shape as IV rank."""
    if not history:
        raise ValueError("history is empty")
    lo, hi = min(history), max(history)
    if hi == lo:
        return 0.0
    return (value - lo) / (hi - lo) * 100


def summarize_regime(
    history: list[VixObservation], lookback_trading_days: int
) -> VixRegime:
    """Latest VIX level plus its percentile and rank within the trailing
    `lookback_trading_days` observations."""
    if not history:
        raise VixDataUnavailable("no VIX observations to summarize")

    window = history[-lookback_trading_days:]
    values = [o.value for o in window]
    latest = window[-1]
    return VixRegime(
        level=latest.value,
        as_of=latest.day,
        percentile_1y=percentile_of(values, latest.value),
        rank_1y=rank_of(values, latest.value),
        lookback_points=len(window),
    )
