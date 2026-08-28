"""Unit tests for the rebuild guard (scripts/deploy_guard.py).

The Alpaca clock IO lives in main(); these tests pin the pure decision matrix.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.deploy_guard import deploy_blocked  # noqa: E402


def test_market_open_without_force_is_blocked():
    blocked, reason = deploy_blocked(True, force=False)
    assert blocked is True
    assert "refusing to rebuild" in reason


def test_market_open_with_force_is_allowed_but_warns():
    blocked, reason = deploy_blocked(True, force=True)
    assert blocked is False
    assert "--force" in reason
    assert "killed" in reason


def test_market_closed_is_allowed():
    blocked, reason = deploy_blocked(False, force=False)
    assert blocked is False
    assert "safe to rebuild" in reason


def test_market_closed_with_force_notes_it_is_redundant():
    blocked, reason = deploy_blocked(False, force=True)
    assert blocked is False
    assert "redundant" in reason
