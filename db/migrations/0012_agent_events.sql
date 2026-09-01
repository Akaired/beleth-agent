-- 0012_agent_events.sql — structured event log for the backoffice "Logs" tab.
--
-- The runner already narrates to stdout and to a rotating file on the runner's logs
-- volume, but neither is reachable from the webapp (the agent is outbound-only and
-- shares nothing but this database). This table is the webapp-facing event stream: a
-- curated, filterable line per meaningful thing that happens — a decision, a submitted
-- or failed order, a risk rejection, an exit trigger, a position anomaly, a
-- pause/resume, a runner error. Roughly a handful of rows per cycle, not a firehose.
--
-- Shape:
--   level    debug | info | warn | error
--   event    machine slug the UI filters on (decision, order_submitted, ...)
--   symbol   underlying when the event is about one, else null
--   message  human one-liner shown in the table
--   context  arbitrary structured payload (order id, credit, reject reasons, ...)
--   decision_id  links the event to its decision row when there is one
--
-- Access mirrors 0005 / 0011: demo_admin and master_admin may read; anon and
-- public_user see nothing; no write policy, so only the service-role key writes.
--
-- Idempotent: safe to re-run.

create table if not exists public.agent_events (
    id          bigint      generated always as identity primary key,
    created_at  timestamptz not null default now(),
    level       text        not null default 'info'
                            check (level in ('debug', 'info', 'warn', 'error')),
    event       text        not null,
    symbol      text            null,
    message     text        not null,
    context     jsonb       not null default '{}'::jsonb,
    decision_id uuid            null references public.decisions (id) on delete set null
);

create index if not exists idx_agent_events_created_at
    on public.agent_events (created_at desc);
create index if not exists idx_agent_events_event
    on public.agent_events (event, created_at desc);

alter table public.agent_events enable row level security;

drop policy if exists "backoffice reads agent events" on public.agent_events;
create policy "backoffice reads agent events"
    on public.agent_events
    for select
    to authenticated
    using (public.beleth_role() in ('demo_admin', 'master_admin'));
