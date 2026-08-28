"""Integration tests against the real Supabase project (service-role key from .env).

Self-cleaning: every row these tests create is deleted in a ``finally`` block, and the
agent_status row is snapshotted and restored. They never touch the ``trades`` table
(nothing writes to it yet). The whole module skips cleanly when Supabase is unconfigured
or the migration has not been applied.
"""

from datetime import datetime, timezone

import pytest

from app.config import get_settings
from app.decision import DecisionDraft
from app.persistence import (
    EXPECTED_TABLES,
    PersistenceConfigError,
    agent_status_row,
    delete_decision,
    delete_position,
    fetch_agent_status,
    fetch_decision,
    fetch_latest_decision,
    fetch_position,
    fetch_risk_checks,
    fetch_table_names,
    mirror_positions,
    persist_agent_status,
    persist_decision,
    persist_risk_checks,
    supabase_config_from_settings,
)
from app.persistence import _request
from app.risk_check import RuleResult, RiskVerdict

pytestmark = pytest.mark.integration

ITEST_SYMBOL = "ITEST-BELETH"


@pytest.fixture(scope="module")
def supabase_config():
    try:
        return supabase_config_from_settings(get_settings())
    except PersistenceConfigError as exc:
        pytest.skip(f"Supabase not configured: {exc}")


@pytest.fixture(scope="module", autouse=True)
def require_schema(supabase_config):
    tables = set(fetch_table_names(supabase_config))
    missing = [t for t in EXPECTED_TABLES if t not in tables]
    if missing:
        pytest.skip(f"migration not applied — missing tables: {', '.join(missing)}")


def _make_draft(**overrides) -> DecisionDraft:
    kwargs = {
        "as_of": datetime.now(timezone.utc),
        "symbol": "SPY",
        "action": "no_trade",
        "decision_source": "risk_engine",
        "summary": "[itest] integration test decision row — safe to delete.",
        "market_open": True,
        "equity": 12345.67,
        "day_pnl": -12.34,
        "evidence": {"itest": True, "nested": {"ok": True}},
        "strategy_config": {"itest": True},
    }
    kwargs.update(overrides)
    return DecisionDraft(**kwargs)


def _verdict() -> RiskVerdict:
    return RiskVerdict(
        approved=False,
        max_loss=250.0,
        breakeven=449.5,
        results=[
            RuleResult("R4", True, "R4 itest", {"max_loss": 250.0}),
            RuleResult("R6", False, "R6 itest rejection", {"per_trade_cap_usd": 100.0}),
            RuleResult("R7", True, "R7 itest", {}),
        ],
        candidate={"symbol": "SPY", "dte": 30, "itest": True},
    )


def test_expected_tables_exist(supabase_config):
    assert set(EXPECTED_TABLES) <= set(fetch_table_names(supabase_config))


def test_decision_and_risk_checks_round_trip(supabase_config):
    decision_id = persist_decision(supabase_config, draft=_make_draft())
    try:
        row = fetch_decision(supabase_config, decision_id)
        assert row is not None
        assert row["summary"] == "[itest] integration test decision row — safe to delete."
        assert float(row["equity"]) == 12345.67
        assert float(row["day_pnl"]) == -12.34
        assert row["evidence"]["nested"]["ok"] is True  # jsonb round trip
        assert row["strategy_config"]["itest"] is True

        assert (
            persist_risk_checks(
                supabase_config, decision_id=decision_id, verdicts=[_verdict()]
            )
            == 3
        )
        checks = fetch_risk_checks(supabase_config, decision_id)
        assert [c["rule"] for c in checks] == ["R4", "R6", "R7"]
        assert all(c["candidate_index"] == 0 for c in checks)
        assert checks[1]["passed"] is False
        assert float(checks[0]["max_loss"]) == 250.0  # numeric round trip

        latest = fetch_latest_decision(supabase_config)
        assert latest is not None and isinstance(latest["summary"], str)
    finally:
        delete_decision(supabase_config, decision_id)
    assert fetch_decision(supabase_config, decision_id) is None


def test_agent_status_upsert_keeps_single_row_and_restores_previous(supabase_config):
    previous = fetch_agent_status(supabase_config)
    try:
        persist_agent_status(
            supabase_config,
            agent_status_row(
                state="idle",
                last_cycle_at=datetime.now(timezone.utc),
                detail={"itest": 1},
            ),
        )
        persist_agent_status(
            supabase_config,
            agent_status_row(
                state="monitoring",
                last_cycle_at=datetime.now(timezone.utc),
                detail={"itest": 2},
            ),
        )
        status = fetch_agent_status(supabase_config)
        assert status is not None
        assert status["id"] == 1
        assert status["state"] == "monitoring"
        assert status["detail"] == {"itest": 2}
    finally:
        if previous is None:
            _request(supabase_config, "DELETE", "agent_status", params={"id": "eq.1"})
        else:
            persist_agent_status(supabase_config, dict(previous))


def test_positions_mirror_preserves_first_seen_at(supabase_config):
    dump = {
        "symbol": ITEST_SYMBOL,
        "qty": "7",
        "side": "long",
        "avg_entry_price": "123.45",
        "market_value": "124.00",
        "cost_basis": "1234.50",
        "unrealized_pl": "-0.50",
        "asset_class": "us_option",
    }
    try:
        assert mirror_positions(supabase_config, [dump]) == (1, 0)
        first = fetch_position(supabase_config, ITEST_SYMBOL, select="symbol,first_seen_at,qty")
        assert first is not None
        assert float(first["qty"]) == 7.0

        assert mirror_positions(supabase_config, [dump | {"qty": "9"}]) == (1, 0)
        second = fetch_position(supabase_config, ITEST_SYMBOL, select="symbol,first_seen_at,qty")
        assert second is not None
        assert float(second["qty"]) == 9.0
        assert second["first_seen_at"] == first["first_seen_at"]  # DB trigger preserves it
    finally:
        delete_position(supabase_config, ITEST_SYMBOL)
    assert fetch_position(supabase_config, ITEST_SYMBOL) is None