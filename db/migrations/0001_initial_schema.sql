-- Beleth agent — initial Supabase schema (milestone 4).
--
-- Applied by hand: Supabase dashboard -> SQL Editor -> paste whole file -> Run.
-- Idempotent: every statement is safe to re-run.
--
-- Write path: the agent only, with the service-role key (which bypasses RLS).
-- Read path: the webapp, added in the later RLS milestone — the tables below are created
-- WITH row level security and NO policies, so anon/authenticated can see nothing at all.
-- We deliberately do not REVOKE from anon/authenticated: the RLS deny-all is already
-- sufficient, and a REVOKE would silently fight the permissive policies that milestone adds.

-- ── 1. trigger helpers ────────────────────────────────────────────────────────────────

-- Mirror tables carry a client-managed business payload; updated_at stays DB-owned so a
-- writer cannot forget it.
create or replace function public.beleth_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- positions.first_seen_at is when OUR mirror first saw the position. Alpaca's Position
-- model does not expose the position's own creation timestamp, so we derive it: defaulted
-- on first insert, left untouched by every later upsert.
create or replace function public.beleth_preserve_first_seen_at()
returns trigger language plpgsql as $$
begin
  new.first_seen_at = coalesce(old.first_seen_at, new.first_seen_at);
  return new;
end;
$$;

-- ── 2. decisions ──────────────────────────────────────────────────────────────────────
-- One row per agent cycle. Append-only: a re-run adds a row, it never overwrites one.
-- llm_* columns are nullable until the LLM decision layer milestone fills them.
create table if not exists public.decisions (
    id              uuid          primary key default gen_random_uuid(),  -- client-generated uuid4
    as_of           timestamptz   not null,
    created_at      timestamptz   not null default now(),
    agent_version   text          not null default 'dev',
    decision_source text          not null default 'risk_engine'
                                  check (decision_source in ('risk_engine', 'llm')),
    symbol          text          not null,
    action          text          not null check (action in ('trade', 'no_trade')),
    summary         text          not null,          -- plain-language verdict, first-class on purpose
    market_open     boolean       not null,
    equity          numeric(14,2) not null,          -- denormalized: P&L series source for the dashboard
    day_pnl         numeric(14,2) not null,
    llm_model       text              null,          -- {model id} of the OpenRouter call, when it happens
    llm_reasoning   text              null,          -- raw LLM reasoning for the demo-admin backoffice
    llm_usage       jsonb             null,          -- {prompt_tokens, completion_tokens, total_tokens}
    evidence        jsonb         not null,          -- full evidence package (constraint #5)
    strategy_config jsonb         not null           -- snapshot of config/strategy.yaml at decision time
);
create index if not exists idx_decisions_created_at on public.decisions (created_at desc);

-- ── 3. risk_checks ────────────────────────────────────────────────────────────────────
-- Normalized: one row per (decision, candidate, rule). Rejections are first-class rows —
-- queryable independently, shown with the same prominence as fills (constraint #3).
create table if not exists public.risk_checks (
    id              uuid          primary key default gen_random_uuid(),
    decision_id     uuid          not null references public.decisions (id) on delete cascade,
    created_at      timestamptz   not null default now(),
    candidate_index integer       not null default 0,   -- groups the rule rows of one verdict
    rule            text          not null,             -- 'R4' | 'R6' | 'R7' (R5 later, with exits)
    passed          boolean       not null,
    reason          text          not null,             -- human-readable, names the rule and its numbers
    detail          jsonb         not null default '{}'::jsonb,
    candidate       jsonb         not null,             -- full candidate dict: each row is self-contained
    approved        boolean       not null,             -- verdict-level, denormalized for flat reads
    max_loss        numeric(14,2)     null,
    breakeven       numeric(14,4)     null
);
create index if not exists idx_risk_checks_decision on public.risk_checks (decision_id, candidate_index);
create index if not exists idx_risk_checks_rule     on public.risk_checks (rule);

-- ── 4. trades ─────────────────────────────────────────────────────────────────────────
-- Schema only in this milestone: there is no order path yet. The column is "underlying",
-- not "symbol", because Alpaca omits top-level symbol on multileg orders.
create table if not exists public.trades (
    id               uuid          primary key default gen_random_uuid(),
    decision_id      uuid          not null references public.decisions (id) on delete cascade,
    created_at       timestamptz   not null default now(),
    underlying       text          not null,
    alpaca_order_id  text              null unique,
    client_order_id  text              null,
    status           text              null,
    qty              numeric(18,8)     null,
    filled_qty       numeric(18,8)     null,
    filled_avg_price numeric(14,4)     null,
    legs             jsonb             null,
    credit           numeric(14,4)     null,
    max_loss         numeric(14,2)     null,
    submitted_at     timestamptz       null,
    filled_at        timestamptz       null,
    raw              jsonb             null
);
create index if not exists idx_trades_decision on public.trades (decision_id);

-- ── 5. positions ──────────────────────────────────────────────────────────────────────
-- Current-state mirror, upserted every cycle. Closed positions are deleted explicitly by
-- symbol (never a table-wide delete). Alpaca reports the numerics as strings; the agent
-- converts them before writing.
create table if not exists public.positions (
    symbol           text          primary key,
    first_seen_at    timestamptz   not null default now(),
    updated_at       timestamptz   not null default now(),
    qty              numeric(18,8) not null,
    side             text          not null,
    avg_entry_price  numeric(14,4)     null,
    market_value     numeric(14,2)     null,
    cost_basis       numeric(14,2)     null,
    unrealized_pl    numeric(14,2)     null,
    asset_class      text              null,
    raw              jsonb             null
);
create trigger trg_positions_touch_updated_at
    before update on public.positions
    for each row execute function public.beleth_touch_updated_at();
create trigger trg_positions_preserve_first_seen
    before update on public.positions
    for each row execute function public.beleth_preserve_first_seen_at();

-- ── 6. agent_status ───────────────────────────────────────────────────────────────────
-- Single row (id=1), upserted every cycle. `state` drives the public-status page and the
-- mascot; the allowed vocabulary lives in app/persistence.py (AGENT_STATES), not in a
-- CHECK, so adding a state is not a migration. `paused` is the master-admin operational
-- switch — the agent reads it and never writes it (its upsert omits the column).
create table if not exists public.agent_status (
    id               integer      primary key check (id = 1),
    state            text         not null,
    paused           boolean      not null default false,
    last_decision_id uuid             null references public.decisions (id) on delete set null,
    last_cycle_at    timestamptz  not null,
    updated_at       timestamptz  not null default now(),
    detail           jsonb        not null default '{}'::jsonb
);
create trigger trg_agent_status_touch_updated_at
    before update on public.agent_status
    for each row execute function public.beleth_touch_updated_at();

-- ── 7. row level security: enabled, zero policies ─────────────────────────────────────
-- Deny-all for anon/authenticated. The service role bypasses RLS, so the agent write path
-- is unaffected. Per-role policies are the webapp milestone's work, not this file's.
alter table public.decisions    enable row level security;
alter table public.risk_checks  enable row level security;
alter table public.trades       enable row level security;
alter table public.positions    enable row level security;
alter table public.agent_status enable row level security;