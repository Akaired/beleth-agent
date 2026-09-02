"""Client order ids the agent stamps on the orders it submits.

These prefixes are not cosmetic and they are not configuration. They are the fallback
by which a resting order is recognised as this agent's own, and as an entry rather than
a close, when the broker does not report readable leg intents — which the paper API has
repeatedly failed to do. That classification is what stops a second entry stacking on a
position, and what stops a duplicate close being sent against one that is already
closing.

Two things follow, and both are load-bearing:

* **The exit prefix extends the entry prefix.** Every id this module produces starts
  with ``beleth-``; an exit's also starts with ``beleth-exit-``. So a classifier must
  test the exit prefix *first*. Reversing the two `if`s would classify every closing
  order as an entry: exits would stop de-duplicating and would start blocking entries.
  `is_exit_id` / `is_agent_id` exist so no caller has to remember that.
* **They must match what was already submitted.** Changing a prefix orphans every
  resting order that carries the old one — the agent would no longer recognise its own
  positions' orders. That is why these are literals in one module and not a knob.
"""

from __future__ import annotations

import uuid

ENTRY_PREFIX = "beleth-"
EXIT_PREFIX = "beleth-exit-"


def new_entry_id() -> str:
    return f"{ENTRY_PREFIX}{uuid.uuid4().hex}"


def new_exit_id() -> str:
    return f"{EXIT_PREFIX}{uuid.uuid4().hex}"


def is_exit_id(client_order_id: str | None) -> bool:
    return bool(client_order_id) and client_order_id.startswith(EXIT_PREFIX)  # type: ignore[union-attr]


def is_agent_id(client_order_id: str | None) -> bool:
    """True for any order this agent submitted, entry or exit."""
    return bool(client_order_id) and client_order_id.startswith(ENTRY_PREFIX)  # type: ignore[union-attr]
