"""Integration tests against the real Supabase project (service-role key from .env).

Self-cleaning: every row these tests create is deleted in a ``finally`` block, and the
agent_status row is snapshotted and restored (the ``trades`` and ``risk_checks`` rows
cascade from their decision row, so deleting the decision cleans them). The whole module
skips cleanly when Supabase is unconfigured or the migration has not been applied.
"""

from datetime import UTC, date, datetime

import pytest

from app.config import get_settings
from app.decision import DecisionDraft
from app.exits import OpenSpread, evaluate_exit
from app.persistence import (
    EXPECTED_TABLES,
    PersistenceConfigError,
    _request,
    agent_status_row,
    delete_decision,
    delete_position,
    fetch_agent_status,
    fetch_decision,
    fetch_latest_decision,
    fetch_position,
    fetch_risk_checks,
    fetch_table_names,
    fetch_trades_for_decision,
    mirror_positions,
    persist_agent_status,
    persist_decision,
    persist_exit_checks,
    persist_risk_checks,
    persist_trade,
    supabase_config_from_settings,
    trade_row,
)
from app.risk_check import RiskVerdict, RuleResult

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
        "as_of": datetime.now(UTC),
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
            persist_risk_checks(supabase_config, decision_id=decision_id, verdicts=[_verdict()])
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
                last_cycle_at=datetime.now(UTC),
                detail={"itest": 1},
            ),
        )
        persist_agent_status(
            supabase_config,
            agent_status_row(
                state="monitoring",
                last_cycle_at=datetime.now(UTC),
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
    # The mirror table is shared with any live agent: snapshot every other row so the
    # stale-sweep inside mirror_positions cannot delete real data mid-test, then
    # restore it (the upsert writes the same values back, first_seen_at included).
    others = [
        row
        for row in (_request(supabase_config, "GET", "positions") or [])
        if row["symbol"] != ITEST_SYMBOL
    ]
    if others:
        _request(
            supabase_config,
            "DELETE",
            "positions",
            params={"symbol": f"neq.{ITEST_SYMBOL}"},
        )
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
        if others:
            _request(
                supabase_config,
                "POST",
                "positions",
                params={"on_conflict": "symbol"},
                json_body=others,
                prefer="resolution=merge-duplicates",
            )
    assert fetch_position(supabase_config, ITEST_SYMBOL) is None


def test_exit_trade_rows_and_r5_checks_round_trip(supabase_config):
    """Migration 0002 round trip: an exit trades row carries kind='exit' and the fired R5
    rule; each open spread's R5 verdict lands as a risk_checks row. Both cascade away
    with the decision."""
    draft = _make_draft(action="trade", summary="[itest] exit round trip — safe to delete.")
    decision_id = persist_decision(supabase_config, draft=draft)
    try:
        persist_trade(
            supabase_config,
            trade_row(
                decision_id=decision_id,
                underlying="SPY",
                qty=2,
                credit=None,
                max_loss=None,
                legs=[{"role": "short", "symbol": "SPY260918P00440000", "strike": 440.0}],
                order=_ORDER_DUMP_IEST,
                kind="exit",
                exit_reason="profit_target",
            ),
        )
        trades = fetch_trades_for_decision(supabase_config, decision_id)
        assert len(trades) == 1
        assert trades[0]["kind"] == "exit"
        assert trades[0]["exit_reason"] == "profit_target"

        spread = OpenSpread(
            short_symbol="SPY260918P00440000",
            long_symbol="SPY260918P00435000",
            right="P",
            expiry=date(2026, 9, 18),
            short_strike=440.0,
            long_strike=435.0,
            qty=1,
            short_entry_price=1.20,
            long_entry_price=0.30,
        )
        evaluation = evaluate_exit(
            spread,
            short_bid=0.80,
            short_ask=0.91,
            long_bid=0.35,
            long_ask=0.45,
            underlying_last=450.0,
            profit_target_pct=50,
            loss_multiple=2,
            exit_on_short_itm=True,
        )
        assert (
            persist_exit_checks(supabase_config, decision_id=decision_id, evaluations=[evaluation])
            == 1
        )
        checks = fetch_risk_checks(supabase_config, decision_id)
        assert [c["rule"] for c in checks] == ["R5"]
        assert checks[0]["passed"] is True and checks[0]["approved"] is False
        assert checks[0]["candidate"]["short_symbol"] == "SPY260918P00440000"
    finally:
        delete_decision(supabase_config, decision_id)
    assert fetch_trades_for_decision(supabase_config, decision_id) == []


_ORDER_DUMP_IEST = {
    "id": "0b5c6a4e-0000-0000-0000-000000000009",
    "client_order_id": "beleth-itest-exit",
    "status": "accepted",
    "qty": "2",
    "filled_qty": "0",
    "filled_avg_price": None,
    "submitted_at": "2026-08-28T14:05:00Z",
    "filled_at": None,
    "legs": [{"symbol": "SPY260918P00440000", "side": "buy"}],
}
