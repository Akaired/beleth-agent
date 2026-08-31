-- 0027_realtime_publication.sql — stream Postgres changes to the webapp.
--
-- Why: the webapp's server-rendered pages went stale behind ISR (the homepage
-- rebuilt at most once a minute, and low traffic stretched "a minute" into
-- hours). The fix is a small client component, <LiveRefresh />, that calls
-- `router.refresh()` when something actually changes. It listens on Supabase
-- Realtime, which only delivers rows for tables that belong to the
-- `supabase_realtime` publication — this migration adds the five the agent
-- writes.
--
-- This grants nothing. Realtime enforces the same row level security as a
-- normal read, so a subscriber sees a change only if it already had SELECT on
-- that row via the anon/authenticated policies in 0003. Adding a table here
-- just turns on its change feed.
--
-- Idempotent: `alter publication ... add table` errors if the table is already
-- a member, so each add is guarded against `pg_publication_tables`.

do $$
declare
  t text;
begin
  foreach t in array array[
    'decisions', 'risk_checks', 'trades', 'positions', 'agent_status'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
