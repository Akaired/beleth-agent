"""Assemble the evidence package handed to the model each cycle.

Numbers, not prose: the model already knows what theta is; it needs to know what it's worth
today. Every persisted decision must carry the evidence package that produced it, so any
choice can be reconstructed after the fact.

This module only shapes already-computed inputs into the agreed structure (see the schema in
the milestone brief / docs/strategy.md "evidence package"). All IO — Alpaca, FRED, the
calendar file — happens in the caller (see scripts/check_market_data.py).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.market.calendar import MacroEvent, TenorBlock
from app.market.realized_vol import RealizedVolResult
from app.market.term_structure import TermStructure
from app.market.vix import VixRegime
from app.options.spreads import SpreadCandidate
from app.vrp import TenorVrp


@dataclass(frozen=True)
class AccountSnapshot:
    cash: float
    buying_power: float
    open_positions: int
    day_pnl: float
    risk_budget_remaining_today: float


def _rv_map(rvs: dict[int, RealizedVolResult]) -> dict[str, float | None]:
    return {f"{w}d": (rvs[w].value if w in rvs else None) for w in sorted(rvs)}


def build_evidence_package(
    *,
    as_of: datetime,
    market_open: bool,
    underlying_symbol: str,
    underlying_last: float,
    realized_vols: dict[int, RealizedVolResult],
    vix_regime: VixRegime | None,
    vix_error: str | None,
    term_structure: TermStructure,
    tenor_vrp: list[TenorVrp],
    next_event: MacroEvent | None,
    blocked_tenors: list[TenorBlock],
    now_et: datetime,
    candidates: list[SpreadCandidate],
    account: AccountSnapshot,
) -> dict[str, Any]:
    rv20 = realized_vols.get(20)
    rv20_value = rv20.value if rv20 is not None else None

    vix_block: dict[str, Any]
    if vix_regime is not None:
        vix_block = {
            "level": vix_regime.level,
            "as_of": vix_regime.as_of.isoformat(),
            "percentile_1y": round(vix_regime.percentile_1y, 2),
            "rank_1y": round(vix_regime.rank_1y, 2),
            "lookback_points": vix_regime.lookback_points,
            "term_structure": term_structure.state,
            "short_atm_iv": term_structure.short_atm_iv,
            "long_atm_iv": term_structure.long_atm_iv,
            "term_structure_short_dte": term_structure.short_dte,
            "term_structure_long_dte": term_structure.long_dte,
        }
    else:
        vix_block = {
            "level": None,
            "error": vix_error or "VIX data unavailable",
            "term_structure": term_structure.state,
            "short_atm_iv": term_structure.short_atm_iv,
            "long_atm_iv": term_structure.long_atm_iv,
            "term_structure_short_dte": term_structure.short_dte,
            "term_structure_long_dte": term_structure.long_dte,
        }

    vix_minus_rv20: float | None = None
    if vix_regime is not None and rv20_value is not None:
        vix_minus_rv20 = round(vix_regime.level - rv20_value * 100, 4)

    per_tenor = [
        {
            "dte": t.dte,
            "atm_iv": t.atm_iv,
            "vrp_vs_rv20": None if t.vrp_vs_rv20 is None else round(t.vrp_vs_rv20, 4),
            "passes_threshold": t.passes_threshold,
        }
        for t in tenor_vrp
    ]

    next_event_block: dict[str, Any] | None = None
    if next_event is not None:
        next_event_block = {
            "name": next_event.name,
            "datetime_et": next_event.when_et.isoformat(),
            "importance": next_event.importance,
            "days_away": round((next_event.when_et - now_et).total_seconds() / 86400, 2),
        }

    return {
        "as_of": as_of.isoformat(),
        "market_open": market_open,
        "underlying": {
            "symbol": underlying_symbol,
            "last": underlying_last,
            "realized_vol": _rv_map(realized_vols),
        },
        "vix": vix_block,
        "vrp": {
            "vix_minus_rv20": vix_minus_rv20,
            "per_tenor": per_tenor,
        },
        "calendar": {
            "next_macro_event": next_event_block,
            "blocks_tenors": [b.dte for b in blocked_tenors],
            "blocks_detail": [
                {"dte": b.dte, "expiry": b.expiry.isoformat(), "event": b.event.name}
                for b in blocked_tenors
            ],
        },
        "candidates": [c.as_dict() for c in candidates],
        "account": {
            "cash": account.cash,
            "buying_power": account.buying_power,
            "open_positions": account.open_positions,
            "day_pnl": account.day_pnl,
            "risk_budget_remaining_today": account.risk_budget_remaining_today,
        },
    }
