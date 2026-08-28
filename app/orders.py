"""The order path — sizing and submission of ONE multi-leg vertical spread order.

This module is downstream of the risk gate by construction: the only submission entry
point is ``submit_mleg_order``, and the caller (``scripts/check_market_data.py``) reaches
it only with a candidate that already passed R4/R6/R7 and a decision — deterministic or
LLM — that chose to trade. There is no path from a rejected candidate to an order
(the hard constraint #3), and every structure is a single ``mleg`` order with both
legs covered inside it — never two separate orders, never a naked leg (constraint #4).

Conventions verified against the vendored SDK/spec (``the local reference cache``):

* ``order_class="mleg"`` requires ``qty`` (number of spreads), 2–4 uniquely-symbol'd legs
  and a limit/market type; options support ``time_in_force="day"`` only.
* ``OptionLegRequest`` carries ``side`` and ``position_intent``; for a new short vertical
  the short leg is ``sell_to_open`` and the long leg ``buy_to_open``; closing one is the
  mirror image (``buy_to_close`` the short, ``sell_to_close`` the long).
* For an mleg limit order a **positive** ``limit_price`` is a net debit, a **negative**
  one a net credit — a credit spread is submitted with a negative limit, and a closing
  order normally with a positive one (we pay to get out).
* The submitted legs are the structure's own chain symbols (``short_symbol`` /
  ``long_symbol``), so the order trades exactly the contracts that were measured.

Sizing uses the existing ``risk.max_risk_per_trade_pct_of_equity`` cap: the quantity is
how many spreads fit under the cap at the candidate's known max loss — the same number
the R6 check validated for one spread, so an approved candidate always sizes to at least
one. Closing orders size themselves (the spread's own remaining quantity): an exit is
risk reduction, so it passes the R5 exit verdict instead of the entry gate. Everything
fails closed: a structure that cannot be sized, priced or submitted produces a typed
"do not send" outcome or a raised error the caller records — never a best-effort order.
"""

from __future__ import annotations

import math
from typing import Any

from alpaca.trading.enums import OrderClass, OrderSide, PositionIntent, TimeInForce
from alpaca.trading.requests import LimitOrderRequest, OptionLegRequest

from app.exits import OpenSpread
from app.options.spreads import SpreadCandidate

CONTRACT_MULTIPLIER = 100  # one option contract covers 100 shares


class OrderSubmissionError(RuntimeError):
    """Alpaca refused or failed an order submission. The caller records the failure —
    it never retries silently (a retried order could double a position)."""


# --- sizing -----------------------------------------------------------------------------------


def compute_quantity(
    equity: float, max_risk_pct_of_equity: float, max_loss_per_spread: float | None
) -> int:
    """How many of this spread fit under the per-trade risk cap.

    ``floor(cap / max_loss_per_spread)``: the combined worst case of the whole order
    stays within ``max_risk_per_trade_pct_of_equity`` percent of equity. Returns 0 —
    do not trade — when even one spread would break the cap, or when the inputs are
    unusable (unknown or non-positive max loss, non-positive equity).
    """
    if equity is None or equity <= 0:
        return 0
    if max_loss_per_spread is None or max_loss_per_spread <= 0:
        return 0
    cap = equity * max_risk_pct_of_equity / 100
    return int(cap // max_loss_per_spread)


def credit_limit_price(credit: float | None, slippage: float) -> float | None:
    """The order's net-credit limit: the measured (mid) credit minus the configured
    slippage, floored to the cent so the limit never demands more credit than measured.

    Alpaca's mleg convention makes a credit a *negative* limit price, so the returned
    value is negative (e.g. measured credit 0.60, slippage 0.02 -> ``-0.58``). Returns
    ``None`` — do not send — when the structure is unpriced, has no credit, or cannot
    absorb the slippage concession while staying a net credit.
    """
    if credit is None or credit <= 0:
        return None
    net = credit - slippage
    if net <= 0:
        return None
    return -math.floor(net * 100) / 100


# --- closing (exit) orders --------------------------------------------------------------------


def closing_limit_price(mark_debit: float | None, slippage: float) -> float | None:
    """The limit for the order that closes a short vertical: what we will pay to get out.

    ``mark_debit`` is the measured per-share cost to close (short mid minus long mid,
    positive = we pay). Closing is risk *reduction*, so the limit is priced to fill, not
    to haggle: up to the mark plus the configured slippage concession, floored to the
    cent (Alpaca rejects limit prices beyond 2 decimal places). When the mark is a net
    *credit* — the market pays us to leave — the limit demands that credit minus the
    slippage; when that concession would swallow the whole credit, the limit falls back
    to a 1-cent debit: exiting a position the rules say to close is worth a cent, and a
    guaranteed fill beats a resting order on a protective exit.

    Returns ``None`` — do not send — when the close cannot be measured at all.
    """
    if mark_debit is None:
        return None
    if mark_debit >= 0:
        return math.floor((mark_debit + slippage) * 100) / 100
    credit_available = -mark_debit
    demand = credit_available - slippage
    if demand <= 0:
        return 0.01  # market would pay us to close; a 1-cent debit still guarantees the exit
    return -math.floor(demand * 100) / 100


# --- order construction -----------------------------------------------------------------------


def build_mleg_order(
    candidate: SpreadCandidate,
    qty: int,
    limit_price: float,
    client_order_id: str,
) -> LimitOrderRequest:
    """One vertical credit spread as a single two-leg ``mleg`` limit order.

    Both legs are opened inside this one order (``sell_to_open`` the short, ``buy_to_open``
    the long), so the structure is covered by construction — Alpaca rejects an mleg order
    whose short legs are not covered within the same order. ``time_in_force`` is ``day``
    because that is the only TIF options support. The limit is negative (net credit).
    """
    short_leg = OptionLegRequest(
        symbol=candidate.short_symbol,
        ratio_qty=1,
        side=OrderSide.SELL,
        position_intent=PositionIntent.SELL_TO_OPEN,
    )
    long_leg = OptionLegRequest(
        symbol=candidate.long_symbol,
        ratio_qty=1,
        side=OrderSide.BUY,
        position_intent=PositionIntent.BUY_TO_OPEN,
    )
    return LimitOrderRequest(
        qty=qty,
        order_class=OrderClass.MLEG,
        time_in_force=TimeInForce.DAY,
        limit_price=limit_price,
        legs=[short_leg, long_leg],
        client_order_id=client_order_id,
    )


def describe_legs(candidate: SpreadCandidate) -> list[dict[str, Any]]:
    """Self-contained leg description for the persisted ``trades.legs`` payload — the
    strikes and roles a dashboard reader needs, independent of the raw Alpaca dump."""
    return [
        {
            "role": "short",
            "symbol": candidate.short_symbol,
            "right": candidate.right,
            "strike": candidate.short_strike,
            "side": "sell",
            "position_intent": "sell_to_open",
            "ratio_qty": 1,
        },
        {
            "role": "long",
            "symbol": candidate.long_symbol,
            "right": candidate.right,
            "strike": candidate.long_strike,
            "side": "buy",
            "position_intent": "buy_to_open",
            "ratio_qty": 1,
        },
    ]


def build_closing_mleg_order(
    spread: OpenSpread,
    qty: int,
    limit_price: float,
    client_order_id: str,
) -> LimitOrderRequest:
    """One short vertical closed as a single two-leg ``mleg`` limit order.

    Both legs close inside this one order (``buy_to_close`` the short, ``sell_to_close``
    the long) — the exact mirror of the opening order, so the structure stays covered
    inside the order and is never split. ``time_in_force`` is ``day`` (the only options
    TIF). The limit's sign follows the same debit/credit convention as the entry order:
    closing normally costs a debit (positive limit); a negative limit is a credit demand
    for the rare close the market pays us to make.
    """
    short_leg = OptionLegRequest(
        symbol=spread.short_symbol,
        ratio_qty=1,
        side=OrderSide.BUY,
        position_intent=PositionIntent.BUY_TO_CLOSE,
    )
    long_leg = OptionLegRequest(
        symbol=spread.long_symbol,
        ratio_qty=1,
        side=OrderSide.SELL,
        position_intent=PositionIntent.SELL_TO_CLOSE,
    )
    return LimitOrderRequest(
        qty=qty,
        order_class=OrderClass.MLEG,
        time_in_force=TimeInForce.DAY,
        limit_price=limit_price,
        legs=[short_leg, long_leg],
        client_order_id=client_order_id,
    )


def describe_closing_legs(spread: OpenSpread) -> list[dict[str, Any]]:
    """Self-contained leg description for the closing order's ``trades.legs`` payload."""
    return [
        {
            "role": "short",
            "symbol": spread.short_symbol,
            "right": spread.right,
            "strike": spread.short_strike,
            "side": "buy",
            "position_intent": "buy_to_close",
            "ratio_qty": 1,
        },
        {
            "role": "long",
            "symbol": spread.long_symbol,
            "right": spread.right,
            "strike": spread.long_strike,
            "side": "sell",
            "position_intent": "sell_to_close",
            "ratio_qty": 1,
        },
    ]


# --- submission ---------------------------------------------------------------------------


def submit_mleg_order(trading_client: Any, request: LimitOrderRequest) -> dict[str, Any]:
    """Submit the order and return it as a JSON-safe dump (parent order with its nested
    legs). Any API error becomes ``OrderSubmissionError`` with the SDK's message — the
    caller persists the failure; there is no in-module retry."""
    try:
        order = trading_client.submit_order(request)
    except Exception as exc:  # noqa: BLE001 — a submission failure must reach the caller as one type
        raise OrderSubmissionError(f"{type(exc).__name__}: {exc}") from exc
    return order.model_dump(mode="json")