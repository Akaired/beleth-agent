"""What each stage of the cycle hands to the next.

One frozen dataclass per stage, not one mutable context object threaded through
everything. A mutable context reproduces the problem the extraction is meant to solve —
forty locals in one frame, with no signature saying which stage may read or write what
— and a single frozen god-context threaded as `(ctx) -> ctx` says nothing either.

So each stage returns its own outputs and receives the previous stages' results as
explicit parameters. The types below are that contract, and reading them is how you find
out what the cycle actually depends on at each point.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.evidence import AccountSnapshot
from app.exits import ExitEvaluation, OpenSpread
from app.market.realized_vol import RealizedVolResult
from app.market.term_structure import TermStructure
from app.market.vix import VixRegime
from app.options.spreads import SpreadCandidate
from app.risk_check import AccountRiskState, RiskVerdict
from app.vrp import TenorVrp


@dataclass(frozen=True)
class CycleConfig:
    """The symbol this cycle is for, plus the strategy file it runs under.

    `today_ordinal` and `now_et` are captured once, at the top of the cycle, so every
    stage measures tenors and calendar windows against the same instant. A cycle that
    read the clock twice could block a tenor in one stage and build it in another.
    """

    symbol: str
    strategy: dict[str, Any]
    today_ordinal: int
    now_et: datetime


@dataclass(frozen=True)
class Clients:
    """The three Alpaca clients, built once. Trading is paper-only by construction —
    `app.alpaca_client.get_trading_client` asserts it before handing one out."""

    trading: Any
    options: Any
    stocks: Any


@dataclass(frozen=True)
class MarketEvidence:
    """Everything measured from market data, before the account is looked at.

    `vix_error` is a first-class field rather than an exception: an absent VIX never
    blocks trading (R2 backwardation is the real regime gate), but it does change how
    R9 sizes, so the reason has to reach the persisted decision.
    """

    underlying_last: float
    realized_vols: dict[int, RealizedVolResult]
    rv20: float | None
    vix_regime: VixRegime | None
    vix_error: str | None
    chain: dict[str, Any]
    term_structure: TermStructure
    tenor_vrp: list[TenorVrp]
    next_event: Any
    blocked_tenors: list[Any]
    blocked_dtes: set[int]
    backwardation_block: bool
    candidates: list[SpreadCandidate]


@dataclass(frozen=True)
class AccountState:
    """The account as the cycle found it, and what that means for new risk.

    `entry_blocks` is the list of reasons a new entry must be refused regardless of any
    candidate's own merits — an unpaired leg, a spread whose risk cannot be sized, a
    resting entry order, an unreadable order book. Each becomes a visible R10 rejection
    row rather than a silent skip.
    """

    equity: float
    day_pnl: float
    capital_at_risk: float
    open_position_count: int
    market_open: bool
    positions: list[Any]
    open_spreads: list[OpenSpread]
    position_anomalies: list[dict[str, Any]]
    exit_evaluations: list[ExitEvaluation]
    triggered_exits: list[ExitEvaluation]
    open_orders: list[Any]
    open_orders_error: str
    entry_blocks: list[dict[str, str]]
    snapshot: AccountSnapshot
    risk_state: AccountRiskState


@dataclass(frozen=True)
class GateOutcome:
    """The risk gate's verdicts, plus the R9 size multiplier they were taped with.

    `vix_size_mult` must travel with the verdicts. It is the one value whose loss is
    silent and expensive: `plan_orders` defaults it to 1.0, so a dropped multiplier
    doubles the position size in a tapered regime without any rejection row to show
    for it.
    """

    verdicts: list[RiskVerdict]
    vix_size_mult: float
    vix_size_reason: str


@dataclass(frozen=True)
class OrderPlans:
    """The orders this cycle may send, entry and exits, and nothing sent yet.

    Prepared before persistence and submitted after it — that ordering is the reason
    planning and execution are separate stages at all.
    """

    entry: dict[str, Any] | None
    exits: list[dict[str, Any]]
    exit_notes: str


@dataclass(frozen=True)
class ExecutionOutcome:
    """What actually happened at the broker and in the database."""

    decision_id: str | None
    persisted_checks: int
    persisted_exit_checks: int
    upserted_positions: int
    submitted_order: dict[str, Any] | None
    order_failure: str | None
    submitted_exits: int
    failed_exits: int
    exit_outcomes: list[dict[str, Any]]
    persistence_failed: bool = False
