"""Unit tests for app/persistence.py — pure row shaping and config resolution, no network."""

import uuid
from dataclasses import FrozenInstanceError
from datetime import datetime, timezone

import pytest

from app.config import Settings
from app.decision import DecisionDraft
from app.persistence import (
    PersistenceConfigError,
    PersistenceError,
    SupabaseConfig,
    agent_status_row,
    decision_row,
    position_rows,
    risk_check_rows,
    supabase_config_from_settings,
)
from app.risk_check import RuleResult, RiskVerdict


def _settings(**overrides) -> Settings:
    kwargs = {
        "_env_file": None,
        "alpaca_api_key": "k",
        "alpaca_secret_key": "s",
        "openrouter_key": "r",
    }
    kwargs.update(overrides)
    return Settings(**kwargs)


def _make_draft(**overrides) -> DecisionDraft:
    kwargs = {
        "as_of": datetime(2026, 8, 28, 14, 0, tzinfo=timezone.utc),
        "symbol": "SPY",
        "action": "no_trade",
        "decision_source": "risk_engine",
        "summary": "No trade: test summary.",
        "market_open": True,
        "equity": 100000.0,
        "day_pnl": -25.5,
        "evidence": {"as_of": "2026-08-28T14:00:00+00:00", "nested": {"ok": True}},
        "strategy_config": {"risk": {"max_concurrent_positions": 5}},
    }
    kwargs.update(overrides)
    return DecisionDraft(**kwargs)


def _make_verdict(
    *,
    approved=False,
    max_loss=400.0,
    breakeven=450.25,
    results=None,
    candidate=None,
) -> RiskVerdict:
    if results is None:
        results = [
            RuleResult("R4", True, "R4 ok", {"max_loss": max_loss}),
            RuleResult("R6", False, "R6 too big", {"candidate_max_loss": max_loss}),
            RuleResult("R7", True, "R7 ok", {}),
        ]
    return RiskVerdict(
        approved=approved,
        max_loss=max_loss,
        breakeven=breakeven,
        results=results,
        candidate=candidate if candidate is not None else {"symbol": "SPY", "dte": 30},
    )


# --- configuration ------------------------------------------------------------------------


def test_config_raises_when_unconfigured():
    with pytest.raises(PersistenceConfigError):
        supabase_config_from_settings(_settings())


def test_config_strips_trailing_slash_and_reads_agent_version(monkeypatch):
    monkeypatch.setenv("AGENT_VERSION", "test-sha")
    config = supabase_config_from_settings(
        _settings(
            supabase_url="https://abc.supabase.co/",
            supabase_service_role_key="key",
        )
    )
    assert config.base_url == "https://abc.supabase.co"
    assert config.agent_version == "test-sha"


def test_config_defaults_agent_version_to_dev():
    config = supabase_config_from_settings(
        _settings(supabase_url="https://abc.supabase.co", supabase_service_role_key="key")
    )
    assert config.agent_version == "dev"


# --- decision rows ------------------------------------------------------------------------


def test_decision_row_shape_without_llm_fields():
    row = decision_row(_make_draft())
    assert set(row) == {
        "id",
        "as_of",
        "agent_version",
        "decision_source",
        "symbol",
        "action",
        "summary",
        "market_open",
        "equity",
        "day_pnl",
        "evidence",
        "strategy_config",
    }
    assert str(uuid.UUID(row["id"])) == row["id"]  # a parseable uuid4
    assert row["as_of"] == "2026-08-28T14:00:00+00:00"
    assert row["evidence"]["nested"]["ok"] is True
    assert row["strategy_config"]["risk"]["max_concurrent_positions"] == 5


def test_decision_row_includes_llm_fields_when_given():
    draft = _make_draft(
        llm_model="test/model:free",
        llm_reasoning="because",
        llm_usage={"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    )
    row = decision_row(draft)
    assert row["llm_model"] == "test/model:free"
    assert row["llm_reasoning"] == "because"
    assert row["llm_usage"]["total_tokens"] == 15


def test_decision_row_uses_explicit_agent_version():
    row = decision_row(_make_draft(), agent_version="abc123")
    assert row["agent_version"] == "abc123"


def test_decision_row_converts_datetime_inside_evidence():
    row = decision_row(_make_draft(evidence={"ts": datetime(2026, 8, 28, 12, 0, tzinfo=timezone.utc)}))
    assert row["evidence"]["ts"] == "2026-08-28T12:00:00+00:00"


# --- risk-check rows ----------------------------------------------------------------------


def test_risk_check_rows_one_row_per_rule():
    rows = risk_check_rows("decision-1", [_make_verdict()])
    assert len(rows) == 3
    assert [r["rule"] for r in rows] == ["R4", "R6", "R7"]
    assert all(r["decision_id"] == "decision-1" for r in rows)
    assert all(r["candidate_index"] == 0 for r in rows)
    assert rows[1]["passed"] is False
    assert rows[1]["reason"] == "R6 too big"


def test_risk_check_rows_flag_rejections_and_verdict_approval():
    rows = risk_check_rows(
        "decision-1", [_make_verdict(approved=False, max_loss=999.0, breakeven=449.0)]
    )
    assert all(r["approved"] is False for r in rows)
    assert rows[0]["max_loss"] == 999.0
    assert rows[0]["breakeven"] == 449.0


def test_risk_check_rows_index_each_candidate():
    verdicts = [_make_verdict(), _make_verdict(approved=True, max_loss=100.0)]
    rows = risk_check_rows("decision-2", verdicts)
    assert {r["candidate_index"] for r in rows} == {0, 1}


def test_risk_check_rows_empty_verdicts_is_empty_list():
    assert risk_check_rows("decision-3", []) == []


# --- position rows -------------------------------------------------------------------------


def _alpaca_position_dump(**overrides):
    dump = {
        "symbol": "SPY250918P00440000",
        "qty": "10",
        "side": "long",
        "asset_class": "us_option",
        "avg_entry_price": "440.15",
        "market_value": "4410.00",
        "cost_basis": "4401.50",
        "unrealized_pl": "8.50",
    }
    dump.update(overrides)
    return dump


def test_position_rows_converts_alpaca_string_numerics():
    rows = position_rows([_alpaca_position_dump()])
    assert len(rows) == 1
    row = rows[0]
    assert row["symbol"] == "SPY250918P00440000"
    assert row["qty"] == 10.0
    assert isinstance(row["qty"], float)
    assert row["avg_entry_price"] == 440.15
    assert row["unrealized_pl"] == 8.5
    assert row["asset_class"] == "us_option"
    assert row["raw"]["qty"] == "10"  # raw payload keeps the source-of-truth strings


def test_position_rows_omits_first_seen_at():
    row = position_rows([_alpaca_position_dump()])[0]
    assert "first_seen_at" not in row


def test_position_rows_empty_when_flat():
    assert position_rows([]) == []


def test_position_rows_handles_null_numerics():
    rows = position_rows([_alpaca_position_dump(avg_entry_price=None)])
    assert rows[0]["avg_entry_price"] is None


# --- agent status row -----------------------------------------------------------------------


def test_agent_status_row_pins_id_to_one_and_omits_paused():
    row = agent_status_row(state="monitoring", last_cycle_at=datetime(2026, 8, 28, 14, 0, tzinfo=timezone.utc))
    assert row["id"] == 1
    assert row["state"] == "monitoring"
    assert "paused" not in row
    assert row["last_cycle_at"] == "2026-08-28T14:00:00+00:00"


def test_agent_status_row_includes_decision_and_detail():
    row = agent_status_row(
        state="idle",
        last_cycle_at=datetime(2026, 8, 28, 14, 0, tzinfo=timezone.utc),
        last_decision_id="abc",
        detail={"candidates": 2},
    )
    assert row["last_decision_id"] == "abc"
    assert row["detail"] == {"candidates": 2}


def test_agent_status_row_rejects_unknown_state():
    with pytest.raises(PersistenceError):
        agent_status_row(state="dancing", last_cycle_at=datetime(2026, 8, 28, tzinfo=timezone.utc))


# --- config dataclass ------------------------------------------------------------------------


def test_supabase_config_is_frozen():
    config = SupabaseConfig(base_url="https://abc.supabase.co", service_role_key="k")
    with pytest.raises(FrozenInstanceError):
        config.base_url = "https://other.supabase.co"