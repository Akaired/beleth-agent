"""Turning a decision into the order it may send.

Three jobs, all pure: match the structure a decision picked back to a candidate the
cycle actually built, size and price a new entry, and price the closings a triggered
exit demands. Nothing here submits anything — the caller does that, and only after the
decision row is persisted.

Everything that could stop an order is expressed as `(None, sentence)` rather than an
exception: the sentence lands in the persisted summary, so a cycle that declines to
trade says why, in the same place a cycle that traded says what it did.
"""

from __future__ import annotations

import math
import sys
from dataclasses import replace
from typing import Any

from app.cycle.context import AccountState, CycleConfig, GateOutcome, MarketEvidence, OrderPlans
from app.cycle.open_orders import working_exit_orders
from app.decision import DecisionDraft
from app.exits import ExitEvaluation, exit_summary_sentences
from app.options.spreads import SpreadCandidate
from app.order_ids import new_entry_id, new_exit_id
from app.orders import (
    build_closing_mleg_order,
    build_mleg_order,
    closing_limit_price,
    compute_quantity,
    credit_limit_price,
    describe_closing_legs,
    describe_legs,
    entry_slippage,
    slippage_within_credit_cap,
)


def _match_candidate(
    candidates: list[SpreadCandidate], chosen: dict[str, Any] | None
) -> SpreadCandidate | None:
    """The built candidate a trade decision picked, matched on its own leg symbols (the
    strongest identity a structure has). ``None`` if the decision carried a structure the
    cycle never built — a fail-closed fault, never an order."""
    if chosen is None:
        return None
    for c in candidates:
        if (
            c.right == chosen.get("right")
            and c.expiry == chosen.get("expiry")
            and c.short_symbol == chosen.get("short_symbol")
            and c.long_symbol == chosen.get("long_symbol")
        ):
            return c
    return None


# Fallback for a config predating `exit.reprice_min_step_usd`; the live value is read
# from config/strategy.yaml, where the rest of the trading thresholds live.
_DEFAULT_REPRICE_MIN_STEP = 0.02


def _reprice_min_step(strategy_config: dict[str, Any]) -> float:
    """Minimum improvement, in dollars, before a resting closing order is replaced.

    Enough to matter, large enough that a cycle does not re-price the same order every
    five minutes (thrash).
    """
    exit_cfg = strategy_config.get("exit") or {}
    return float(exit_cfg.get("reprice_min_step_usd", _DEFAULT_REPRICE_MIN_STEP))


def _prepare_closings(
    triggered: list[ExitEvaluation],
    *,
    working_exits: dict[frozenset[str], dict[str, Any]],
    strategy_config: dict[str, Any],
) -> tuple[list[dict[str, Any]], str]:
    """Turn triggered exits into the closing orders they may send — or, per spread, the
    fail-closed note that lands in the persisted summary instead of an order.

    Plans are *not* submitted here: the caller submits only after the decision row is
    persisted (no order ever goes out unlogged).

    The limit is priced to *fill*: off the marketable debit (``short_ask - long_bid``)
    when available, capped at R5's own loss-close price so a blown-out quote never pays
    more than the rule's defined max. A spread that already has a resting closing order
    is left alone — unless a fresh limit would be materially more aggressive, in which
    case the plan carries ``replace_order_id`` and the caller cancels the stale order
    before sending the new one. Without that, a close priced too tight on a wide book
    rests unfilled all session and blocks its own re-pricing."""
    slippage = strategy_config["exit"]["close_slippage_usd"]
    reprice_min_step = _reprice_min_step(strategy_config)
    plans: list[dict[str, Any]] = []
    notes: list[str] = []
    for evaluation in triggered:
        spread = evaluation.spread
        detail = evaluation.detail
        leg_set = frozenset({spread.short_symbol, spread.long_symbol})
        limit_price = closing_limit_price(
            detail.get("mark_to_close"),
            slippage,
            marketable_debit=detail.get("marketable_close"),
        )
        if limit_price is None:
            notes.append(
                f" {spread.short_symbol}: no closing order — the close cannot be priced "
                "(no usable leg quotes), fail-closed; it re-arms next cycle."
            )
            continue
        # Never bid more to close than the rule's own loss-close price (a defined max);
        # only caps a debit, never a credit demand.
        loss_cap = detail.get("loss_close_price")
        if loss_cap is not None and limit_price > 0 and limit_price > loss_cap:
            limit_price = math.floor(loss_cap * 100) / 100

        resting = working_exits.get(leg_set)
        replace_order_id = None
        if resting is not None:
            resting_limit = resting.get("limit")
            if resting_limit is None or limit_price <= resting_limit + reprice_min_step:
                notes.append(
                    f" {spread.short_symbol}: a closing order is already working — not duplicated."
                )
                continue
            replace_order_id = resting.get("id")

        request = build_closing_mleg_order(
            spread,
            spread.qty,
            limit_price,
            client_order_id=new_exit_id(),
        )
        plans.append(
            {
                "request": request,
                "qty": spread.qty,
                "limit": abs(limit_price),
                "credit_to_close": limit_price < 0,
                "legs": describe_closing_legs(spread),
                "exit_reason": evaluation.rule,
                "spread": spread.as_dict(),
                "client_order_id": request.client_order_id,
                "replace_order_id": replace_order_id,
            }
        )
        kind = "net-credit" if limit_price < 0 else "net-debit"
        if replace_order_id is not None:
            note = (
                f" The resting closing order for {spread.short_symbol} is being repriced "
                f"to a {abs(limit_price):.2f} {kind} limit ({spread.qty} spread(s)) so it "
                "fills; the trades log carries the outcome."
            )
        else:
            note = (
                f" One closing order for {spread.short_symbol} ({spread.qty} spread(s) at a "
                f"{abs(limit_price):.2f} {kind} limit) is being sent; the trades log "
                "carries the outcome."
            )
        notes.append(note)
    return plans, ("".join(notes) if notes else "")


def _prepare_order(
    chosen: dict[str, Any] | None,
    candidates: list[SpreadCandidate],
    *,
    equity: float,
    strategy_config: dict[str, Any],
    risk_pct_multiplier: float = 1.0,
) -> tuple[dict[str, Any] | None, str]:
    """Turn a ``trade`` decision into the single mleg order it may send — or ``None`` plus
    the fail-closed sentence that goes into the persisted summary instead of an order.

    ``risk_pct_multiplier`` (default 1.0) is the R9 VIX-taper scale on the per-trade risk
    budget: 0.5 halves the quantity that fits under the cap. A hard block (multiplier 0.0)
    never reaches here — it has already rejected the candidate at the gate.

    The plan is *not* submitted here: the caller submits only after the decision row is
    persisted, so no order ever goes out unlogged."""
    candidate = _match_candidate(candidates, chosen)
    if candidate is None or chosen is None:
        return None, (
            " No order was sent: the decision did not carry a candidate this cycle built "
            "(fail-closed)."
        )

    max_loss = chosen.get("max_loss")
    credit = chosen.get("credit")
    qty = compute_quantity(
        equity,
        strategy_config["risk"]["max_risk_per_trade_pct_of_equity"] * risk_pct_multiplier,
        max_loss,
    )
    structure = strategy_config["structure"]
    # Dynamic entry slippage: the larger of the fixed floor and a fraction of the
    # candidate's own bid/ask width. A fixed 0.02 floor sits below the half-spread on
    # most index-ETF spreads, so an order priced to the mid rests unfilled.
    slippage = entry_slippage(
        candidate.net_quote_width,
        floor_usd=structure["credit_slippage_usd"],
        frac_of_spread=structure.get("credit_slippage_frac_of_spread", 0.0),
    )
    max_frac_of_credit = structure.get("max_slippage_frac_of_credit", 0.0)

    if qty < 1:
        taper_note = (
            f", after the R9 VIX taper cut the per-trade budget to {risk_pct_multiplier * 100:.0f}%"
            if risk_pct_multiplier != 1.0
            else ""
        )
        return None, (
            f" No order was sent: sizing cannot fit even one spread under the per-trade "
            f"risk cap (max loss {max_loss} at {equity:.2f} equity{taper_note}) — "
            "fail-closed."
        )
    if (
        credit is not None
        and credit > 0
        and not slippage_within_credit_cap(slippage, credit, max_frac_of_credit=max_frac_of_credit)
    ):
        return None, (
            f" No order was sent: to be marketable this spread's limit would concede "
            f"${slippage:.2f} of its ${credit:.2f} measured credit "
            f"(bid/ask width {candidate.net_quote_width}), above the "
            f"{max_frac_of_credit * 100:.0f}% cap — an explicit no-trade beats an order "
            "that never fills (fail-closed)."
        )

    limit_price = credit_limit_price(credit, slippage)
    if limit_price is None:
        return None, (
            f" No order was sent: no fillable net-credit limit exists (credit {credit}, "
            f"slippage {slippage:.2f}) — fail-closed."
        )

    request = build_mleg_order(candidate, qty, limit_price, client_order_id=new_entry_id())
    note = (
        f" One multi-leg order ({qty} spread(s) at a {abs(limit_price):.2f} net-credit "
        f"limit — {slippage:.2f} slippage off the {credit:.2f} measured mid) is being "
        "sent; the trades log carries the outcome."
    )
    return (
        {
            "request": request,
            "qty": qty,
            "credit": abs(limit_price),
            "max_loss": max_loss,
            "legs": describe_legs(candidate),
            "client_order_id": request.client_order_id,
        },
        note,
    )


def plan_orders(
    cfg: CycleConfig,
    market: MarketEvidence,
    state: AccountState,
    gates: GateOutcome,
    draft: DecisionDraft,
) -> tuple[OrderPlans, DecisionDraft]:
    """Everything this cycle may send, and the decision text that goes with it.

    Nothing is submitted here. The plans are built before the decision row is written
    and sent after it, which is the whole reason planning and execution are separate
    stages: an order live at the broker with no decision row is the one state this
    project must never produce.

    The draft comes back amended, because what the cycle *did* has to be visible in the
    sentence it persists:

    * the order note — the size and limit that were sent, or the fail-closed reason
      nothing was;
    * R9's reason whenever the taper was not neutral, so a smaller trade or a stated
      "no" is never silent;
    * the exit sentences first, because managing open positions outranks new entries;
    * `action='trade'` when a close is going out, since closing a spread is itself a
      trade the dashboard must show as one — an exit-only cycle has no entry candidate.

    `gates.vix_size_mult` is passed to `_prepare_order` explicitly. Its default there is
    1.0, so forgetting it would double the size in a tapered regime with nothing in the
    log to show for it.
    """
    exit_plans: list[dict[str, Any]] = []
    exit_notes = ""
    if state.triggered_exits and state.market_open:
        if state.open_orders_error:
            # Fail-closed against duplicates: without the order book a resting close
            # cannot be ruled out. The rule stays triggered and re-arms next cycle.
            print(
                "WARNING: open orders unavailable — closings are not sent this cycle "
                "(fail-closed); they re-arm next cycle.",
                file=sys.stderr,
            )
        else:
            exit_plans, exit_notes = _prepare_closings(
                state.triggered_exits,
                working_exits=working_exit_orders(state.open_orders),
                strategy_config=cfg.strategy,
            )

    entry: dict[str, Any] | None = None
    if draft.action == "trade" and draft.chosen_candidate is not None:
        entry, order_note = _prepare_order(
            draft.chosen_candidate,
            market.candidates,
            equity=state.equity,
            strategy_config=cfg.strategy,
            risk_pct_multiplier=gates.vix_size_mult,
        )
        draft = replace(draft, summary=draft.summary + order_note)
    if gates.vix_size_mult != 1.0:
        draft = replace(draft, summary=draft.summary + " " + gates.vix_size_reason)

    exit_sentences = exit_summary_sentences(state.exit_evaluations, market_open=state.market_open)
    if exit_sentences or exit_notes:
        draft = replace(draft, summary=exit_sentences + exit_notes + draft.summary)
    if exit_plans:
        draft = replace(draft, action="trade")

    return OrderPlans(entry=entry, exits=exit_plans, exit_notes=exit_notes), draft
