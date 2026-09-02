"""The client-order-id prefixes are the agent's fallback identity for its own resting
orders when the broker does not report leg intents. Getting them wrong is not cosmetic:
it stops exits de-duplicating and starts them blocking entries.
"""

from __future__ import annotations

from app.order_ids import (
    ENTRY_PREFIX,
    EXIT_PREFIX,
    is_agent_id,
    is_exit_id,
    new_entry_id,
    new_exit_id,
)


def test_the_exit_prefix_extends_the_entry_prefix():
    """The whole reason `is_exit_id` must be asked before `is_agent_id`."""
    assert EXIT_PREFIX.startswith(ENTRY_PREFIX)
    assert EXIT_PREFIX != ENTRY_PREFIX


def test_an_exit_id_is_both_an_exit_and_this_agent_s():
    exit_id = new_exit_id()
    assert is_exit_id(exit_id)
    assert is_agent_id(exit_id)


def test_an_entry_id_is_this_agent_s_and_not_an_exit():
    entry_id = new_entry_id()
    assert is_agent_id(entry_id)
    assert not is_exit_id(entry_id)


def test_a_foreign_or_missing_id_is_neither():
    for value in (None, "", "manual-order-1", "beleth", "somethingbeleth-exit-1"):
        assert not is_agent_id(value)
        assert not is_exit_id(value)


def test_ids_are_unique_per_call():
    assert new_entry_id() != new_entry_id()
    assert new_exit_id() != new_exit_id()


def test_the_prefixes_are_the_ones_already_stamped_on_live_orders():
    """Changing either value orphans every resting order carrying the old one — the
    agent stops recognising its own. Pinned so that is a deliberate act."""
    assert ENTRY_PREFIX == "beleth-"
    assert EXIT_PREFIX == "beleth-exit-"
