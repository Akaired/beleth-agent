-- 0013_agent_events_backfill.sql — seed the event log with the history that
-- predates it, and make the kill switch write to it going forward.
--
-- `agent_events` (0012) starts empty: the runner only begins emitting events
-- after its next redeploy. This migration reconstructs the history that already
-- exists in the authoritative tables — `decisions`, `trades`,
-- `agent_control_events`, `risk_checks` — so the Logs tab is not blank for the
-- period the agent has already traded (from the first day it traded). Every
-- reconstructed row carries `context->>'backfill' = 'true'` so it is always
-- distinguishable from a live emission; `context->>'derived_from'` names the
-- source table.
--
-- It also:
--   * removes the six `host_metrics` rows captured from a developer laptop
--     while the Host panel was being built (`metrics->platform->>system` =
--     'Darwin') — only the agent host's own readings belong there;
--   * extends `beleth_set_agent_paused` so a dashboard kill-switch flip also
--     lands in `agent_events` (event `paused` / `resumed`), which lets the
--     backoffice drop its separate "Control history" panel and show everything
--     in one stream.
--
-- Idempotent: it deletes the prior backfill rows (and the Darwin host rows)
-- before re-inserting, so it is safe to re-run.

begin;

-- ── 0. clean slate for re-runs ──────────────────────────────────────────────
delete from public.agent_events where (context ->> 'backfill') = 'true';
delete from public.host_metrics
 where coalesce(metrics -> 'platform' ->> 'system', '') = 'Darwin';

-- ── 1. kill-switch history → paused / resumed ───────────────────────────────
insert into public.agent_events (created_at, level, event, message, context)
select
    e.created_at,
    'info',
    case when e.action = 'pause' then 'paused' else 'resumed' end,
    case when e.action = 'pause'
         then 'kill switch engaged via dashboard'
         else 'kill switch cleared via dashboard' end,
    jsonb_build_object(
        'backfill', true,
        'derived_from', 'agent_control_events',
        'actor_email', e.actor_email
    )
from public.agent_control_events e;

-- ── 2. decisions → decision / no_trade ─────────────────────────────────────
insert into public.agent_events
    (created_at, level, event, symbol, message, context, decision_id)
select
    d.created_at,
    'info',
    case when d.action = 'trade' then 'decision' else 'no_trade' end,
    d.symbol,
    left(d.summary, 500),
    jsonb_build_object(
        'backfill', true,
        'derived_from', 'decisions',
        'action', d.action,
        'source', d.decision_source
    ),
    d.id
from public.decisions d;

-- ── 3. decisions with a rejected risk gate → risk_rejected ─────────────────
-- One row per decision that had at least one entry-rule (R4/R6/R7) rejection
-- and no fully-approved candidate — this is where the anti-stacking
-- guard (R6) shows up.
insert into public.agent_events
    (created_at, level, event, symbol, message, context, decision_id)
select
    d.created_at,
    'warn',
    'risk_rejected',
    d.symbol,
    format(
        '%s candidate(s) rejected at the risk gate (%s)',
        (select count(distinct rc.candidate_index)
           from public.risk_checks rc
          where rc.decision_id = d.id
            and rc.rule in ('R4', 'R6', 'R7')
            and rc.passed = false),
        (select string_agg(distinct rc.rule, ', ' order by rc.rule)
           from public.risk_checks rc
          where rc.decision_id = d.id
            and rc.rule in ('R4', 'R6', 'R7')
            and rc.passed = false)
    ),
    jsonb_build_object('backfill', true, 'derived_from', 'risk_checks'),
    d.id
from public.decisions d
where exists (
        select 1 from public.risk_checks rc
         where rc.decision_id = d.id
           and rc.rule in ('R4', 'R6', 'R7')
           and rc.passed = false
      )
  and not exists (
        select 1 from public.risk_checks rc
         where rc.decision_id = d.id
           and rc.approved = true
      );

-- ── 4. trades → order_submitted / order_failed / exit_submitted / exit_failed
insert into public.agent_events
    (created_at, level, event, symbol, message, context, decision_id)
select
    t.created_at,
    case when t.status = 'submission_failed' then 'error' else 'info' end,
    case
        when t.kind = 'exit' and t.status = 'submission_failed' then 'exit_failed'
        when t.kind = 'exit'                                     then 'exit_submitted'
        when t.status = 'submission_failed'                      then 'order_failed'
        else 'order_submitted'
    end,
    t.underlying,
    case
        when t.status = 'submission_failed' then
            format('%s order rejected before submission', t.kind)
        when t.kind = 'exit' then
            format('closing order %s (%s)',
                   coalesce(t.alpaca_order_id, '?'), coalesce(t.exit_reason, 'exit'))
        else
            format('entry order %s — %sx, credit %s, max loss %s',
                   coalesce(t.alpaca_order_id, '?'),
                   trim_scale(t.qty), trim_scale(t.credit), trim_scale(t.max_loss))
    end,
    jsonb_build_object(
        'backfill', true,
        'derived_from', 'trades',
        'status', t.status,
        'alpaca_order_id', t.alpaca_order_id,
        'kind', t.kind
    ),
    t.decision_id
from public.trades t;

-- ── 5. kill switch also emits to agent_events from now on ──────────────────
create or replace function public.beleth_set_agent_paused(p_paused boolean)
returns public.agent_status
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_email   text;
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

  select email into v_email from auth.users where id = v_uid;

  update public.agent_status
     set paused = p_paused
   where id = 1
  returning * into v_row;

  if v_current is distinct from p_paused then
    insert into public.agent_control_events (actor, actor_email, action)
    values (v_uid, v_email, case when p_paused then 'pause' else 'resume' end);

    insert into public.agent_events (level, event, message, context)
    values (
      'info',
      case when p_paused then 'paused' else 'resumed' end,
      case when p_paused
           then 'kill switch engaged via dashboard'
           else 'kill switch cleared via dashboard' end,
      jsonb_build_object('source', 'dashboard', 'actor_email', v_email)
    );
  end if;

  return v_row;
end;
$$;

revoke all on function public.beleth_set_agent_paused(boolean) from public, anon;
grant execute on function public.beleth_set_agent_paused(boolean) to authenticated;

commit;
