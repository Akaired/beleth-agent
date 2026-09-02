-- 0033_close_the_anonymous_write_primitive.sql
--
-- Two reads/writes that were open wider than anything needs them to be.
--
-- 1. `beleth_forum_bump_view` (0008) is SECURITY DEFINER, granted to anon, with no
--    check of any kind: one anon-key call increments `forum_topics.view_count`, and
--    nothing stops the next ten thousand. That is an unauthenticated, unbounded UPDATE
--    on a hot-indexed table — a write primitive handed out with the public key.
--
--    Anonymous callers no longer get it. A view is counted once per signed-in reader
--    per topic per UTC day, recorded in `forum_topic_views`, so a signed-in caller
--    cannot spin it either. The counter now means "distinct signed-in readers", which
--    is a more honest number than the one it replaces; it simply stops growing from
--    anonymous traffic.
--
-- 2. `host_metrics` was readable by demo_admin. The demo login is public — one click
--    from the homepage — and the rows carry the machine's name, kernel, uptime, memory,
--    disk and thermals. It becomes master_admin only, which is what "private host"
--    has to mean. The backoffice panel that reads it is master-facing.
--
-- Neither touches an anonymous *read*, so no coordinated webapp deploy is needed. The
-- host panel simply shows nothing for demo, which is the intent.
--
-- Idempotent.

-- ── 1. a view ledger, so a bump is idempotent per reader per day ─────────────
create table if not exists public.forum_topic_views (
    topic_id  uuid        not null references public.forum_topics (id) on delete cascade,
    viewer_id uuid        not null references auth.users (id) on delete cascade,
    viewed_on date        not null default (now() at time zone 'utc')::date,
    primary key (topic_id, viewer_id, viewed_on)
);

alter table public.forum_topic_views enable row level security;
-- No policy: the ledger is written only by the SECURITY DEFINER function below and is
-- never read by the application. RLS with no policy denies everyone else outright.

create index if not exists idx_forum_topic_views_day
    on public.forum_topic_views (viewed_on);

create or replace function public.beleth_forum_bump_view(p_topic_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  -- Anonymous readers no longer move the counter: an unauthenticated, unbounded UPDATE
  -- is not something to hand out with a public key for a view count.
  if v_uid is null then
    return;
  end if;
  -- The shared demo login writes nothing at all (0029 / 0030).
  if public.beleth_role() = 'demo_admin' then
    return;
  end if;

  insert into public.forum_topic_views (topic_id, viewer_id)
  values (p_topic_id, v_uid)
  on conflict do nothing;

  if not found then
    return;  -- already counted for this reader today
  end if;

  update public.forum_topics
     set view_count = view_count + 1
   where id = p_topic_id;
end;
$$;

revoke all on function public.beleth_forum_bump_view(uuid) from public, anon;
grant execute on function public.beleth_forum_bump_view(uuid) to authenticated;

-- Keep the ledger from growing without bound; a year of history is far more than the
-- dedupe needs. Runs on every bump, one indexed DELETE.
create or replace function public.beleth_prune_topic_views()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.forum_topic_views
   where viewed_on < ((now() at time zone 'utc')::date - 365);
$$;

revoke all on function public.beleth_prune_topic_views() from public, anon, authenticated;

-- ── 2. host telemetry is master-admin only ──────────────────────────────────
drop policy if exists "backoffice reads host metrics" on public.host_metrics;
create policy "master admin reads host metrics"
    on public.host_metrics
    for select
    to authenticated
    using (public.beleth_role() = 'master_admin');
