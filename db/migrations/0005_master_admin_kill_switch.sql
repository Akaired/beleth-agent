-- 0005_master_admin_kill_switch.sql — the first webapp write path.
--
-- Phase 3 of the webapp gives the master-admin account (Davide only) one
-- operational control: the kill switch. `agent_status.paused` is the flag the
-- resident runner reads every cycle and obeys fail-closed (a paused agent
-- produces no new decisions, only a heartbeat). Until now nothing but the
-- service role could write it; this migration lets master_admin flip it —
-- and only it, and only that one column.
--
-- Design:
--   * No UPDATE policy is added to `public.agent_status`. Direct writes stay
--     denied for anon/authenticated exactly as before. The flip goes through
--     one SECURITY DEFINER function that (a) checks `beleth_role()` itself and
--     (b) touches nothing but `paused`, so column scope is guaranteed by the
--     function body, not by a fragile per-column grant.
--   * Every flip is appended to `public.agent_control_events` — an audit trail
--     shown in the read-only backoffice, in keeping with the project's
--     "the account is open for reading" stance. The event log is
--     append-only from SQL's point of view too: no INSERT/UPDATE/DELETE
--     policy, the function is the only writer.
--   * `edit config` and `Alpaca account detail` from the spec §6 are NOT in this
--     migration — they need agent-side work (a DB-backed config override the
--     runner reads, account snapshots persisted to Supabase) and are a later
--     pass.
--
-- Idempotent: safe to re-run.

-- ── 1. audit trail ──────────────────────────────────────────────────────────
create table if not exists public.agent_control_events (
    id          uuid        primary key default gen_random_uuid(),
    actor       uuid            null references auth.users (id) on delete set null,
    actor_email text            null,
    action      text        not null check (action in ('pause', 'resume')),
    created_at  timestamptz not null default now()
);

create index if not exists idx_agent_control_events_created_at
    on public.agent_control_events (created_at desc);

alter table public.agent_control_events enable row level security;

-- demo_admin and master_admin can read the log (it is part of the read-only
-- backoffice). public_user and anon see nothing. No write policy exists — the
-- function below is the only writer, plus the service role.
drop policy if exists "backoffice reads control events" on public.agent_control_events;
create policy "backoffice reads control events"
    on public.agent_control_events
    for select
    to authenticated
    using (public.beleth_role() in ('demo_admin', 'master_admin'));

-- ── 2. the kill switch ──────────────────────────────────────────────────────
-- Flips `agent_status.paused` and logs the change. Raises 42501 for any caller
-- that is not master_admin. A no-op call (already in the requested state) is
-- accepted and returns the row without appending an event. Returns the fresh
-- agent_status row so the caller can render the new state without a re-read.
create or replace function public.beleth_set_agent_paused(p_paused boolean)
returns public.agent_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_current boolean;
  v_row     public.agent_status;
begin
  if public.beleth_role() <> 'master_admin' then
    raise exception 'only master_admin may operate the kill switch'
      using errcode = '42501';
  end if;

  select paused into v_current from public.agent_status where id = 1;
  if not found then
    raise exception 'agent_status row (id=1) does not exist yet';
  end if;

  update public.agent_status
     set paused = p_paused
   where id = 1
  returning * into v_row;

  if v_current is distinct from p_paused then
    insert into public.agent_control_events (actor, actor_email, action)
    values (
      v_uid,
      (select email from auth.users where id = v_uid),
      case when p_paused then 'pause' else 'resume' end
    );
  end if;

  return v_row;
end;
$$;

revoke all on function public.beleth_set_agent_paused(boolean) from public, anon;
grant execute on function public.beleth_set_agent_paused(boolean) to authenticated;
