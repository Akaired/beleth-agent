"""Supabase Postgres write path — the only place the agent talks to the database.

PostgREST over HTTPS with the service-role key (which bypasses RLS). There is no direct
Postgres connection in this project — no DB password is provisioned by design, and the
agent only ever inserts or upserts, which the REST API does with two endpoints. The webapp
reads the same tables through its own Supabase client (see ``db/README.md``).

Design notes:

* Ids are generated client-side (``uuid4``). That is what makes the two-step
  ``decisions -> risk_checks`` write possible without reading anything back, and cascade
  cleanup (smoke test / integration tests) a one-liner.
* Upserts use ``Prefer: resolution=merge-duplicates``; PostgREST only updates the columns
  present in the payload, so ``agent_status.paused`` is deliberately omitted from the
  payload (the agent must never clobber the master-admin pause switch) and
  ``positions.first_seen_at`` is never sent (DB default on insert; a trigger preserves it
  on update).
* No decision logic lives here. Row shaping is pure and unit-tested; transport raises typed
  errors; callers decide what persistence failure means for them (the cycle script exits 1,
  read-only diagnostics keep working).
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import TYPE_CHECKING, Any

import httpx

from app.config import Settings

if TYPE_CHECKING:
    from app.decision import DecisionDraft
    from app.risk_check import RiskVerdict

REST_PATH = "/rest/v1"

EXPECTED_TABLES: tuple[str, ...] = (
    "decisions",
    "risk_checks",
    "trades",
    "positions",
    "agent_status",
)

# The state vocabulary that drives the public status page and the mascot. Kept here rather
# than in a CHECK constraint so adding a state is a code change, not a migration.
AGENT_STATES: tuple[str, ...] = (
    "idle",
    "monitoring",
    "evaluating",
    "trade_executed",
    "risk_check_rejected",
    "drawdown",
    "paused",
)


class PersistenceError(RuntimeError):
    """Base class for every persistence failure."""


class PersistenceConfigError(PersistenceError):
    """Supabase is not configured (missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)."""


class PersistenceRequestError(PersistenceError):
    """PostgREST returned a non-2xx status or the request could not be completed."""


@dataclass(frozen=True)
class SupabaseConfig:
    """Resolved connection settings for the write path. Not secret-bearing beyond the key."""

    base_url: str  # https://<ref>.supabase.co, no trailing slash
    service_role_key: str
    timeout_seconds: float = 15.0
    agent_version: str = "dev"


# --- configuration -----------------------------------------------------------------------


def supabase_config_from_settings(settings: Settings) -> SupabaseConfig:
    """Resolve ``SupabaseConfig`` from settings, failing closed when unconfigured.

    Raises ``PersistenceConfigError`` — not ``ConfigError`` — so callers can tell "persistence
    not configured" (degrade gracefully) from "cannot start at all".
    """
    url = (settings.supabase_url or "").strip()
    key = (settings.supabase_service_role_key or "").strip()
    missing = [
        name
        for name, value in (
            ("SUPABASE_URL", url),
            ("SUPABASE_SERVICE_ROLE_KEY", key),
        )
        if not value
    ]
    if missing:
        raise PersistenceConfigError(
            f"missing {', '.join(missing)} in .env — copy .env.example if needed"
        )
    return SupabaseConfig(
        base_url=url.rstrip("/"),
        service_role_key=key,
        agent_version=settings.agent_version,
    )


# --- transport (private) ------------------------------------------------------------------


def _headers(config: SupabaseConfig, *, prefer: str | None = None) -> dict[str, str]:
    headers = {
        "apikey": config.service_role_key,
        "Authorization": f"Bearer {config.service_role_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if prefer is not None:
        headers["Prefer"] = prefer
    return headers


def _request(
    config: SupabaseConfig,
    method: str,
    table: str | None,
    *,
    params: Mapping[str, str] | None = None,
    json_body: Any = None,
    prefer: str | None = None,
) -> Any:
    """One REST call. Returns the parsed JSON body, or ``None`` for an empty response."""
    url = config.base_url + REST_PATH + (f"/{table}" if table else "/")
    try:
        with httpx.Client(timeout=config.timeout_seconds) as client:
            response = client.request(
                method,
                url,
                headers=_headers(config, prefer=prefer),
                params=params,
                json=json_body,
            )
    except httpx.HTTPError as exc:
        raise PersistenceRequestError(f"Supabase {method} {url} failed: {exc}") from exc
    if response.status_code >= 300:
        raise PersistenceRequestError(
            f"Supabase {method} {url} -> HTTP {response.status_code}: {response.text[:500]}"
        )
    if not response.content:
        return None
    try:
        return response.json()
    except ValueError:
        return None


def _ensure_json_safe(value: Any) -> Any:
    """Recursively convert non-JSON-native values so PostgREST accepts the payload."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, Mapping):
        return {str(k): _ensure_json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_ensure_json_safe(v) for v in value]
    return str(value)  # fail-safe: anything unexpected becomes a readable string


# --- row shaping (pure; unit-tested, no network) -------------------------------------------


def decision_row(draft: DecisionDraft, *, agent_version: str = "dev") -> dict[str, Any]:
    """Shape a ``DecisionDraft`` into a ``decisions`` row. ``created_at`` is DB-owned."""
    row: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "as_of": draft.as_of.isoformat(),
        "agent_version": agent_version,
        "decision_source": draft.decision_source,
        "symbol": draft.symbol,
        "action": draft.action,
        "summary": draft.summary,
        "market_open": draft.market_open,
        "equity": draft.equity,
        "day_pnl": draft.day_pnl,
        "evidence": _ensure_json_safe(draft.evidence),
        "strategy_config": _ensure_json_safe(draft.strategy_config),
    }
    if draft.llm_model is not None:
        row["llm_model"] = draft.llm_model
    if draft.llm_reasoning is not None:
        row["llm_reasoning"] = draft.llm_reasoning
    if draft.llm_usage is not None:
        row["llm_usage"] = _ensure_json_safe(draft.llm_usage)
    return row


def risk_check_rows(
    decision_id: str, verdicts: Sequence[RiskVerdict]
) -> list[dict[str, Any]]:
    """One row per (candidate, rule): ``candidate_index`` groups a verdict's rule rows."""
    rows = []
    for index, verdict in enumerate(verdicts):
        for result in verdict.results:
            rows.append(
                {
                    "id": str(uuid.uuid4()),
                    "decision_id": decision_id,
                    "candidate_index": index,
                    "rule": result.rule,
                    "passed": result.passed,
                    "reason": result.reason,
                    "detail": _ensure_json_safe(result.detail),
                    "candidate": _ensure_json_safe(verdict.candidate),
                    "approved": verdict.approved,
                    "max_loss": verdict.max_loss,
                    "breakeven": verdict.breakeven,
                }
            )
    return rows


def position_rows(model_dumps: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Shape ``Position.model_dump(mode="json")`` dicts. Alpaca reports the numerics as
    strings; convert. ``first_seen_at`` is deliberately not client-sent (DB-owned)."""
    rows = []
    for dump in model_dumps:
        rows.append(
            {
                "symbol": dump["symbol"],
                "qty": float(dump["qty"]),
                "side": dump["side"],
                "avg_entry_price": _float_or_none(dump.get("avg_entry_price")),
                "market_value": _float_or_none(dump.get("market_value")),
                "cost_basis": _float_or_none(dump.get("cost_basis")),
                "unrealized_pl": _float_or_none(dump.get("unrealized_pl")),
                "asset_class": dump.get("asset_class"),
                "raw": _ensure_json_safe(dump),
            }
        )
    return rows


def _float_or_none(value: Any) -> float | None:
    return None if value is None else float(value)


def agent_status_row(
    *,
    state: str,
    last_cycle_at: datetime,
    last_decision_id: str | None = None,
    detail: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Single-row (``id=1``) payload. ``paused`` is deliberately omitted — see module
    docstring. Raises on a state outside ``AGENT_STATES``."""
    if state not in AGENT_STATES:
        raise PersistenceError(
            f"unknown agent state {state!r} — allowed: {', '.join(AGENT_STATES)}"
        )
    row: dict[str, Any] = {
        "id": 1,
        "state": state,
        "last_cycle_at": last_cycle_at.isoformat(),
        "detail": _ensure_json_safe(dict(detail or {})),
    }
    if last_decision_id is not None:
        row["last_decision_id"] = last_decision_id
    return row


# --- write path -----------------------------------------------------------------------------


def persist_decision(config: SupabaseConfig, *, draft: DecisionDraft) -> str:
    """Insert one append-only decision row and return the client-generated id."""
    row = decision_row(draft, agent_version=config.agent_version)
    _request(config, "POST", "decisions", json_body=[row])
    return row["id"]


def persist_risk_checks(
    config: SupabaseConfig, *, decision_id: str, verdicts: Sequence[RiskVerdict]
) -> int:
    """Insert one row per (candidate, rule). Empty verdicts write nothing and cost no request."""
    rows = risk_check_rows(decision_id, verdicts)
    if not rows:
        return 0
    _request(config, "POST", "risk_checks", json_body=rows)
    return len(rows)


def mirror_positions(
    config: SupabaseConfig, model_dumps: Sequence[Mapping[str, Any]]
) -> tuple[int, int]:
    """Make ``positions`` reflect the account's current open positions.

    Upsert first, then delete the symbols that vanished — never an unfiltered DELETE.
    Returns ``(upserted, deleted)``.
    """
    rows = position_rows(model_dumps)
    if rows:
        _request(
            config,
            "POST",
            "positions",
            params={"on_conflict": "symbol"},
            json_body=rows,
            prefer="resolution=merge-duplicates",
        )
    existing = _request(config, "GET", "positions", params={"select": "symbol"}) or []
    stale = sorted({r["symbol"] for r in existing} - {r["symbol"] for r in rows})
    for symbol in stale:
        _request(config, "DELETE", "positions", params={"symbol": f"eq.{symbol}"})
    return len(rows), len(stale)


def persist_agent_status(config: SupabaseConfig, row: Mapping[str, Any]) -> None:
    """Upsert the single ``agent_status`` row (``on_conflict=id``)."""
    _request(
        config,
        "POST",
        "agent_status",
        params={"on_conflict": "id"},
        json_body=[dict(row)],
        prefer="resolution=merge-duplicates",
    )


# --- read path (verification and tests; the webapp has its own client) ----------------------


def fetch_latest_decision(
    config: SupabaseConfig,
    *,
    select: str = "id,summary,action,equity,day_pnl,market_open,created_at",
) -> dict[str, Any] | None:
    data = _request(
        config,
        "GET",
        "decisions",
        params={"select": select, "order": "created_at.desc", "limit": "1"},
    )
    return data[0] if data else None


def fetch_decision(
    config: SupabaseConfig,
    decision_id: str,
    *,
    select: str = "id,summary,action,equity,day_pnl,market_open,evidence,strategy_config",
) -> dict[str, Any] | None:
    data = _request(
        config, "GET", "decisions", params={"select": select, "id": f"eq.{decision_id}"}
    )
    return data[0] if data else None


def fetch_risk_checks(
    config: SupabaseConfig,
    decision_id: str,
    *,
    select: str = "rule,passed,reason,approved,candidate_index,max_loss,breakeven",
) -> list[dict[str, Any]]:
    data = _request(
        config,
        "GET",
        "risk_checks",
        params={
            "select": select,
            "decision_id": f"eq.{decision_id}",
            "order": "candidate_index.asc,rule.asc",
        },
    )
    return data or []


def fetch_table_names(config: SupabaseConfig) -> list[str]:
    """Table names visible to the service role, from the PostgREST OpenAPI document."""
    doc = _request(config, "GET", None) or {}
    definitions = doc.get("definitions") or doc.get("components", {}).get("schemas") or {}
    return sorted(definitions)


def fetch_agent_status(
    config: SupabaseConfig,
    *,
    select: str = "id,state,paused,last_decision_id,last_cycle_at,detail",
) -> dict[str, Any] | None:
    data = _request(config, "GET", "agent_status", params={"select": select, "id": "eq.1"})
    return data[0] if data else None


def fetch_position(
    config: SupabaseConfig,
    symbol: str,
    *,
    select: str = "symbol,first_seen_at,qty,avg_entry_price",
) -> dict[str, Any] | None:
    data = _request(
        config, "GET", "positions", params={"select": select, "symbol": f"eq.{symbol}"}
    )
    return data[0] if data else None


def delete_decision(config: SupabaseConfig, decision_id: str) -> None:
    """Cascade cleanup for the smoke test and integration tests. Production never deletes."""
    _request(config, "DELETE", "decisions", params={"id": f"eq.{decision_id}"})


def delete_position(config: SupabaseConfig, symbol: str) -> None:
    """Single-symbol cleanup for the smoke test and integration tests."""
    _request(config, "DELETE", "positions", params={"symbol": f"eq.{symbol}"})


# --- end-to-end smoke test --------------------------------------------------------------------


def smoke_test(config: SupabaseConfig) -> dict[str, bool]:
    """Self-cleaning round trip: write a marked decision + 3 risk checks, read them back,
    exercise the agent_status and positions upserts (``first_seen_at`` preservation), then
    delete everything. Restores any pre-existing ``agent_status`` row and any pre-existing
    ``positions`` rows (``mirror_positions``' stale-cleanup would otherwise delete every
    symbol not in the smoke payload). Marked rows carry ``agent_version='smoke-test'`` and a
    ``[smoke]`` summary so a leak is identifiable.
    """
    from app.decision import DecisionDraft
    from app.risk_check import RuleResult, RiskVerdict

    results: dict[str, bool] = {}
    smoke_config = replace(config, agent_version="smoke-test")
    previous_status = fetch_agent_status(config)
    preexisting_positions = [
        row
        for row in (_request(config, "GET", "positions") or [])
        if row["symbol"] != "SMOKE-BELETH"
    ]
    decision_id = str(uuid.uuid4())
    smoke_position = {
        "symbol": "SMOKE-BELETH",
        "qty": "10",
        "side": "long",
        "avg_entry_price": "440.15",
        "market_value": "4410.00",
        "cost_basis": "4401.50",
        "unrealized_pl": "8.50",
        "asset_class": "us_option",
    }
    try:
        decision_id = persist_decision(
            smoke_config,
            draft=DecisionDraft(
                as_of=datetime.now(timezone.utc),
                symbol="SPY",
                action="no_trade",
                decision_source="risk_engine",
                summary="[smoke] persistence smoke test row — safe to delete.",
                market_open=False,
                equity=12345.67,
                day_pnl=-12.34,
                evidence={"smoke": True, "nested": {"as_of": datetime.now(timezone.utc)}},
                strategy_config={"smoke": True},
            ),
        )
        results["decision written"] = fetch_decision(smoke_config, decision_id) is not None

        verdict = RiskVerdict(
            approved=False,
            max_loss=100.0,
            breakeven=450.25,
            results=[
                RuleResult("R4", True, "R4 smoke reason", {"max_loss": 100.0}),
                RuleResult("R6", True, "R6 smoke reason", {}),
                RuleResult("R7", False, "R7 smoke rejection reason", {"stop_pct": 3.0}),
            ],
            candidate={"symbol": "SPY", "smoke": True},
        )
        persisted = persist_risk_checks(
            smoke_config, decision_id=decision_id, verdicts=[verdict]
        )
        rows = fetch_risk_checks(smoke_config, decision_id)
        results["risk checks written and read back"] = (
            persisted == 3 and [r["rule"] for r in rows] == ["R4", "R6", "R7"]
            and rows[0]["candidate_index"] == 0
            and all(r["candidate_index"] == 0 for r in rows)
            and rows[-1]["passed"] is False
        )

        # Two-step upsert: write, read first_seen_at, update, read again — the DB trigger
        # must keep first_seen_at stable across the update while qty moves to 5.
        mirror_positions(smoke_config, [smoke_position])
        first_seen = fetch_position(smoke_config, smoke_position["symbol"])
        mirror_positions(smoke_config, [smoke_position | {"qty": "5"}])
        second_seen = fetch_position(smoke_config, smoke_position["symbol"])
        results["positions upsert preserves first_seen_at"] = (
            first_seen is not None
            and second_seen is not None
            and float(second_seen["qty"]) == 5.0
            and first_seen["first_seen_at"] == second_seen["first_seen_at"]
        )

        persist_agent_status(
            smoke_config,
            agent_status_row(
                state="idle",
                last_cycle_at=datetime.now(timezone.utc),
                last_decision_id=decision_id,
                detail={"smoke": True},
            ),
        )
        status = fetch_agent_status(smoke_config, select="id,state")
        results["agent status upserted"] = (
            status is not None and status.get("state") == "idle"
        )

        delete_decision(smoke_config, decision_id)
        results["cleanup removes the smoke decision"] = (
            fetch_decision(smoke_config, decision_id) is None
        )
    finally:
        delete_decision(smoke_config, decision_id)
        delete_position(config, "SMOKE-BELETH")
        if preexisting_positions:
            # Re-upsert the snapshot verbatim. first_seen_at survives: an insert uses the
            # payload's value, and the trigger preserves the existing one on update.
            _request(
                config,
                "POST",
                "positions",
                params={"on_conflict": "symbol"},
                json_body=preexisting_positions,
                prefer="resolution=merge-duplicates",
            )
        if previous_status is None:
            _request(config, "DELETE", "agent_status", params={"id": "eq.1"})
        else:
            persist_agent_status(config, dict(previous_status))
    return results