# Database — Supabase Postgres

Supabase is the **single source of truth** shared by the two components (the project notes hard
constraint #5): the Python agent writes with service-role credentials, the Next.js webapp
reads the same database. There is no other store — no local SQLite, no JSON files.

- The agent talks to PostgREST over HTTPS (`app/persistence.py`): inserts and upserts only.
- Tables are created **with row level security enabled and zero policies**: anonymous and
  authenticated roles see nothing. The service role bypasses RLS, so the agent is unaffected.
  Per-role policies (anonymous / public user / demo admin / master admin) are the webapp
  milestone's work.

## Applying a migration

Migrations are plain SQL files in `db/migrations/`, numbered and append-only — never edit an
applied migration, add a new one. There is no DB password in this project on purpose: the
service-role key only speaks the REST API, which cannot run DDL. Apply with the
Supabase **Management API** from the repo (needs `SUPABASE_ACCESS_TOKEN`, a personal access
token, in `.env` — it is a dashboard credential, never committed):

```bash
uv run python scripts/apply_migration.py db/migrations/0002_exit_trades.sql
```

Or by hand from the dashboard:

1. Open the Supabase dashboard → **SQL Editor**.
2. Paste the full contents of the migration file (e.g. `0001_initial_schema.sql`).
3. **Run.** Every statement is idempotent (`if not exists` / `create or replace`), so re-running
   a file is safe.
4. Verify from the repo: `uv run python scripts/check_supabase_connection.py` (add `--smoke`
   for a full self-cleaning write/read/delete round trip).

## Tables

| Table | Written by | Shape |
|---|---|---|
| `decisions` | agent, one row per cycle, append-only | the decision (action, plain-language `summary`), denormalized `equity`/`day_pnl`/`market_open` for the P&L curve, the **full evidence package** and a snapshot of `config/strategy.yaml` as JSONB, nullable `llm_*` columns for the LLM milestone |
| `risk_checks` | agent, one row per (decision, candidate, rule) — plus one R5 row per open spread | `rule` (`R4`/`R6`/`R7`/`R5`), `passed`, human-readable `reason`, structured `detail`, the full `candidate` — rejections are first-class rows, queryable independently and shown with the same prominence as fills. On an R5 row, `passed` means the spread is within the exit rules and `approved` means a close is demanded |
| `trades` | agent, when a cycle submits an order (entry or R5 close) | the Alpaca multileg order: `underlying`, legs, credit, max loss, status, raw payload. `kind` is `entry` (default) or `exit`; on an exit row `exit_reason` carries the fired R5 rule and `credit`/`max_loss` are null (a close has no entry economics of its own) |
| `positions` | agent, mirrored every cycle (upsert + per-symbol delete of closed ones) | current open positions; `first_seen_at` is derived by trigger, never client-sent |
| `agent_status` | agent, single row `id=1` upserted every cycle | `state` (vocabulary in `app/persistence.py`), `paused` (master-admin switch — the agent never writes it), `last_decision_id` |

## Queries the webapp runs

With the service-role key server-side (or RLS policies once that milestone lands):

```bash
# Latest decision — the anonymous homepage's "what is the agent doing"
GET {SUPABASE_URL}/rest/v1/decisions
    ?select=id,summary,action,equity,day_pnl,market_open,created_at
    &order=created_at.desc&limit=1

# Risk-check detail for that decision (the "no"s are a transparency feature)
GET {SUPABASE_URL}/rest/v1/risk_checks
    ?select=rule,passed,reason,approved,candidate_index
    &decision_id=eq.{id}&order=candidate_index.asc,rule.asc

# P&L curve — one point per persisted cycle
GET {SUPABASE_URL}/rest/v1/decisions
    ?select=created_at,equity,day_pnl&order=created_at.asc

# Rejections log — every failed rule, independent of orders
GET {SUPABASE_URL}/rest/v1/risk_checks
    ?select=rule,reason,created_at&passed=eq.false&order=created_at.desc

# Agent status + open positions
GET {SUPABASE_URL}/rest/v1/agent_status?id=eq.1
GET {SUPABASE_URL}/rest/v1/positions&order=symbol.asc
```

All requests carry `apikey: {SUPABASE_SERVICE_ROLE_KEY}` and
`Authorization: Bearer {SUPABASE_SERVICE_ROLE_KEY}`. The key never leaves `.env` /
server-side environment variables.