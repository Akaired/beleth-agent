"""Reading the account's resting orders.

The seven helpers here answer one question the cycle asks before it does anything else:
what is already working at the broker?

That matters twice over. A resting *entry* order is committed-but-invisible risk — not
yet a position, so neither `open_positions` nor `capital_at_risk` can see it — and
without this the resident loop would stack a new entry on top of it every five minutes.
A resting *closing* order means a triggered exit must not send a second one, which would
stack against the same position.

Classification prefers the broker's own leg intents and falls back to the client order id
this agent stamps (`app.order_ids`). A foreign order with unreadable intents is
`"unknown"`, which callers treat as opening risk: fail-closed, never as a closing.

Pure: no IO, no configuration, no clock.
"""

from __future__ import annotations

from typing import Any

from app.order_ids import is_agent_id, is_exit_id


def _order_leg_symbols(order: Any) -> set[str]:
    """Leg symbols of an open order as the broker reports them (may be absent)."""
    return {
        str(leg.symbol)
        for leg in getattr(order, "legs", None) or []
        if getattr(leg, "symbol", None)
    }


def _order_leg_intents(order: Any) -> set[str]:
    """Leg position intents of an open order, as plain strings (may be absent)."""
    return {
        str(getattr(leg, "position_intent", "") or "") for leg in getattr(order, "legs", None) or []
    }


def _client_order_id(order: Any) -> str:
    return str(getattr(order, "client_order_id", "") or "")


def _classify_open_order(order: Any) -> str:
    """``"entry"`` | ``"close"`` | ``"unknown"`` for a resting order.

    Classified from leg position intents when the broker reports them. When the legs
    carry no readable intent (nested-leg fields have proved unreliable on the paper
    API — resting orders whose leg intents never reach the cycle), an order the agent
    created itself is classified by the client order id
    it stamps on submission (see ``app/order_ids.py``). A
    foreign order with unreadable intents is ``"unknown"`` — callers treat it as
    opening risk (fail-closed), never as a closing.
    """
    intents = _order_leg_intents(order)
    if any("to_open" in intent for intent in intents):
        return "entry"
    if any("to_close" in intent for intent in intents):
        return "close"
    client_order_id = _client_order_id(order)
    # Order matters: every exit id also starts with the entry prefix. `is_exit_id` is
    # asked first for that reason — see app/order_ids.py.
    if is_exit_id(client_order_id):
        return "close"
    if is_agent_id(client_order_id):
        return "entry"
    return "unknown"


def working_exit_leg_sets(open_orders: list[Any]) -> set[frozenset[str]]:
    """Leg-symbol sets of open orders that already close a spread.

    A triggered exit whose spread already has a resting closing order must not submit a
    second one — day-only TIF means an unfilled close dies at the bell and re-arms next
    cycle, but within the session duplicate exits would stack against the same position.
    Entry orders on the same strikes never match, whatever their intents look like.
    """
    sets: set[frozenset[str]] = set()
    for order in open_orders or []:
        if _classify_open_order(order) != "close":
            continue
        symbols = _order_leg_symbols(order)
        if symbols:
            sets.add(frozenset(symbols))
    return sets


def working_exit_orders(open_orders: list[Any]) -> dict[frozenset[str], dict[str, Any]]:
    """Leg-symbol set -> ``{"id", "limit"}`` for every open order that closes a spread.

    Same filter as :func:`working_exit_leg_sets`, but it keeps the order id and its
    absolute limit price so a triggered close can decide whether to leave the resting
    order alone or cancel-and-replace it at a price that actually fills. ``limit`` is
    ``None`` when the broker did not report a readable numeric limit.
    """
    out: dict[frozenset[str], dict[str, Any]] = {}
    for order in open_orders or []:
        if _classify_open_order(order) != "close":
            continue
        symbols = _order_leg_symbols(order)
        if not symbols:
            continue
        raw = getattr(order, "limit_price", None)
        try:
            limit = abs(float(raw)) if raw is not None else None
        except (TypeError, ValueError):
            limit = None
        out[frozenset(symbols)] = {"id": getattr(order, "id", None), "limit": limit}
    return out


def resting_entry_leg_sets(open_orders: list[Any]) -> set[frozenset[str]]:
    """Leg-symbol sets of open orders that OPEN positions — or cannot be ruled out.

    A resting entry order is committed-but-invisible risk: it is not a position yet, so
    neither the position count nor ``capital_at_risk`` sees it. The resident loop runs
    every few minutes, so without blocking on it each cycle could stack another entry
    order on top — multiplying the day's committed risk without the gate ever noticing.
    An order whose legs carry no readable intents is classified by its client order id
    (see :func:`_classify_open_order`); a foreign or otherwise unreadable order also
    blocks — an entry we cannot rule out is an entry.
    """
    sets: set[frozenset[str]] = set()
    for order in open_orders or []:
        if _classify_open_order(order) == "close":
            continue
        symbols = _order_leg_symbols(order)
        sets.add(frozenset(symbols) if symbols else frozenset({"unreadable-legs"}))
    return sets
