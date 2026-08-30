-- 0011_host_metrics.sql — trailing host-telemetry history for the backoffice "Host" panel.
--
-- The resident runner is a container on a a private host in someone's home. The
-- Operational-controls page now shows that machine's vitals (RAM against the 512 MiB
-- container cap, disk, load, CPU temperature, uptime, runner cycles) next to the kill
-- switch. The *current* reading already rides in `agent_status.detail->'host'`, written
-- every heartbeat/cycle. This table is only the short trailing history the sparklines
-- need — the runner appends one row per loop iteration and prunes past 48 h itself
-- (app/persistence.record_host_metrics), so it stays small and needs no cron.
--
-- Access mirrors 0005's `agent_control_events`: demo_admin and master_admin may read
-- (it is part of the read-only backoffice); anon and public_user see nothing; there is
-- no write policy, so only the agent's service-role key (which bypasses RLS) inserts.
--
-- Idempotent: safe to re-run.

create table if not exists public.host_metrics (
    id          bigint      generated always as identity primary key,
    captured_at timestamptz not null default now(),
    metrics     jsonb       not null
);

create index if not exists idx_host_metrics_captured_at
    on public.host_metrics (captured_at desc);

alter table public.host_metrics enable row level security;

drop policy if exists "backoffice reads host metrics" on public.host_metrics;
create policy "backoffice reads host metrics"
    on public.host_metrics
    for select
    to authenticated
    using (public.beleth_role() in ('demo_admin', 'master_admin'));
