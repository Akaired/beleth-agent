# Database — Supabase Postgres

Supabase is the **single source of truth** shared by the two components: the Python agent
writes with service-role credentials, the Next.js webapp reads the same database. There is
no other store — no local SQLite, no JSON files.

- The agent talks to PostgREST over HTTPS (`app/persistence.py`): inserts and upserts only.
  It never writes `agent_status.paused`, which is the operator's switch, not its own.
- **The webapp has no service-role key.** Everything it does runs as `anon` or
  `authenticated` under RLS, and every privileged read or write goes through a
  `SECURITY DEFINER` function that re-checks the caller's role in the database. That is
  deliberate: a role check in a React component is a suggestion, a role check in a
  `beleth_*` function is a rule.

## The four access states

Enforced in the database, not in the UI. `beleth_role()` reads `profiles.role` for
`auth.uid()` and answers `public_user` for anyone unknown — including the agent, whose
service-role connection has no `auth.uid()`.

| State | How it is reached | What it sees |
|---|---|---|
| `anon` | no session | the public read path: `decisions` (minus `llm_reasoning`), `risk_checks`, `trades`, `positions`, `agent_status`, the forum and published docs |
| `public_user` | self-signup | the above, plus their own chat, profile and progress |
| `demo_admin` | **a public one-click login on the homepage** | the whole backoffice, read-only, with emails masked and host telemetry withheld |
| `master_admin` | Davide only | everything, plus the operator controls |

`demo_admin` deserves the emphasis: `demoSignInAction` is an unauthenticated server action
wired to two homepage buttons. Anything the demo account can read is published, and anything
it could write, anyone could write. Migrations `0029` / `0030` settle where that line falls —
it may post in the forum and talk to Beleth, and it may not edit, delete, or touch a profile,
a rating or a storage bucket. `0031` and `0033` narrow what it reads.

## Applying a migration

Migrations are plain SQL files in `db/migrations/`, numbered and append-only. Apply them with
the runner, which keeps a ledger:

```bash
python3 scripts/migrate.py --status      # applied / pending / drifted
python3 scripts/migrate.py --dry-run     # print, send nothing that writes
python3 scripts/migrate.py               # apply everything pending
python3 scripts/migrate.py db/migrations/0034_decision_detail_reader.sql   # one file
```

There is no database password in this project on purpose: the service-role key only speaks
the REST API, which cannot run DDL. The runner uses the Supabase **Management API** and needs
`SUPABASE_ACCESS_TOKEN` (a personal access token) in `.env`, which is gitignored and never
printed. `scripts/apply_migration.py` is the older single-file version it replaced.

The ledger is `public.schema_migrations` (version, name, sha256), with RLS on and no policies,
so it is invisible to `anon` and `authenticated`. The migration and its ledger row travel in
one request, so a failed migration leaves no ledger row. **drifted** means a file changed
after it was applied; `--mark-applied FILE...` re-records a file without executing it, which
is how an existing database is adopted, and the only sanctioned way to edit an applied file.

Every statement in every migration is idempotent — `if not exists`, `create or replace`,
`drop ... if exists` ahead of each `create policy` and `create trigger` — so re-running a file
is safe and a fresh clone can replay the whole directory.

Verify a live database from the repo:
`uv run python scripts/check_supabase_connection.py` (add `--smoke` for a self-cleaning
write/read/delete round trip).

## Tables

Every table has RLS enabled. "policies" below is the count of permissive policies; a table
with none is reachable only through `SECURITY DEFINER` functions or the service role.

### The agent's decision log — the artifact this project is judged on

| Table | Written by | Shape |
|---|---|---|
| `decisions` | agent, one row per cycle, append-only | the decision (action, plain-language `summary`), denormalised `equity`/`day_pnl`/`market_open` for the P&L curve, the **full evidence package** and a snapshot of `config/strategy.yaml` as JSONB, and the `llm_*` columns. `llm_reasoning` is the model's unedited output and is *not* on the public read path (`0035`); `beleth_decision_detail(uuid)` returns it to demo/master |
| `risk_checks` | agent, one row per (decision, candidate, rule) — plus one R5 row per open spread | `rule` (`R4`/`R5`/`R6`/`R7`/`R9`/`R10`/`R11`), `passed`, human-readable `reason`, structured `detail`, the full `candidate`. Rejections are first-class rows, shown with the same prominence as fills. On an R5 row, `passed` means the spread is within the exit rules and `approved` means a close is demanded |
| `trades` | agent, when a cycle submits an order (entry or R5 close) | the Alpaca multileg order: `underlying`, legs, credit, max loss, status. `kind` is `entry` or `exit`; on an exit row `exit_reason` carries the fired R5 rule and `credit`/`max_loss` are null. `raw` is the untouched SDK payload and is not publicly readable (`0035`) |
| `positions` | agent, mirrored every cycle (upsert + per-symbol delete of closed ones) | current open positions; `first_seen_at` is derived by trigger, never client-sent. `raw` as above |
| `agent_status` | agent, single row `id=1` upserted every cycle | `state` (vocabulary in `app/persistence.py`), `paused` (the operator switch — the agent reads and obeys it fail-closed, never writes it), `last_decision_id`. Anonymously readable, which is why the host snapshot was taken out of `detail` |
| `agent_events` | agent, the run narrative | level, event, message, context, optional `decision_id`. Backoffice-only |
| `host_metrics` | agent, one row per runner loop | the machine snapshot behind the operator's Host panel, pruned to 48 h. **master_admin only** (`0033`): it names the private host |

### Accounts, and what people write

| Table | Written by | Notes |
|---|---|---|
| `profiles` | `beleth_handle_new_user` on signup, then `beleth_update_profile` / `beleth_set_avatar_url` | role, display name, avatar, bio, lifecycle status. Demo cannot touch it |
| `user_progress` | `beleth_touch_daily_login` / `beleth_award_chat_xp` | xp and streak behind the sidebar level chip. Demo is a silent no-op |
| `chat_sessions`, `chat_messages` | the `/api/chat` route, as the signed-in user | owner-scoped `for all`; demo may write a turn but not edit or delete one (`0030` triggers) |
| `forum_categories`, `forum_topics`, `forum_posts` | `beleth_forum_*` functions | public read, authenticated write. Demo posts under a "(demo)" alias and may not edit or delete. Body length is bounded by a CHECK constraint (`0032`), which is the one ceiling every path passes through |
| `forum_topic_views` | `beleth_forum_bump_view` only | view dedupe, one row per (topic, reader, UTC day). RLS on, **no policies** — nothing reads it. It exists because the bump used to be an unbounded UPDATE granted to `anon` (`0033`) |
| `docs_categories`, `docs_pages` | `beleth_docs_*` (master only) | published pages are anonymous; drafts are backoffice-only |

### Audit

| Table | Written by | Notes |
|---|---|---|
| `agent_control_events` | `beleth_set_agent_paused` (`0005`) | one row per kill-switch flip: actor, action, timestamp. The webapp's first write path |
| `admin_user_events` | `beleth_admin_set_role` and friends (`0019`) | role changes and deletions. **master_admin only** — it carries email addresses |
| `schema_migrations` | `scripts/migrate.py` | the ledger. RLS on, no policies |

## The public read path

What the anonymous homepage actually asks for, with the anon key
(`webapp/src/lib/queries.ts`). Note that every request names its columns: `select=*` is not
permitted on `decisions`, `trades` or `positions` once `0035` is applied, and a count request
without a `select` defaults to `select=*`.

```bash
# Latest decision — "what is the agent doing"
GET {SUPABASE_URL}/rest/v1/decisions
    ?select=id,created_at,as_of,symbol,action,summary,market_open,equity,day_pnl,decision_source,llm_model,evidence
    &order=created_at.desc&limit=1

# Risk-check detail for that decision (the "no"s are a transparency feature)
GET {SUPABASE_URL}/rest/v1/risk_checks
    ?select=rule,passed,reason,approved,candidate_index
    &decision_id=eq.{id}&order=candidate_index.asc,rule.asc

# P&L curve — one point per persisted cycle
GET {SUPABASE_URL}/rest/v1/decisions?select=created_at,equity,day_pnl&order=created_at.asc

# Counts (HEAD + Prefer: count=exact)
GET {SUPABASE_URL}/rest/v1/trades?select=id&kind=eq.entry&alpaca_order_id=not.is.null
GET {SUPABASE_URL}/rest/v1/positions?select=symbol&side=eq.short

# Agent status
GET {SUPABASE_URL}/rest/v1/agent_status?select=state,paused,last_cycle_at,detail&id=eq.1
```

These carry the **anon** key, which is public by design and safe to ship to a browser —
the boundary is RLS plus the column grants above, not the key. The service-role key belongs
to the agent alone and never leaves `.env` or the container's environment.
