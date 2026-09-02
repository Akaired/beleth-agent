-- 0034_decision_detail_reader.sql — the gated way to read a decision in full.
--
-- `beleth_decision_detail(uuid)` returns every column of one decision, `llm_reasoning`
-- included, to demo_admin and master_admin only. It is purely additive: it exists so
-- the webapp can be switched onto it and DEPLOYED before 0035 takes the column off the
-- public read path. Same idiom as `beleth_admin_list_users`.
--
-- Applying this on its own changes nothing the current site can see.
--
-- Idempotent.

create or replace function public.beleth_decision_detail(p_id uuid)
returns table (
    id              uuid,
    as_of           timestamptz,
    created_at      timestamptz,
    agent_version   text,
    decision_source text,
    symbol          text,
    action          text,
    summary         text,
    market_open     boolean,
    equity          numeric,
    day_pnl         numeric,
    llm_model       text,
    llm_reasoning   text,
    llm_usage       jsonb,
    evidence        jsonb,
    strategy_config jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- The backoffice is the demo account's to read; `llm_reasoning` is the model's
  -- unedited output and belongs behind a session, not behind UI that merely hides it.
  if public.beleth_role() not in ('demo_admin', 'master_admin') then
    raise exception 'only demo_admin or master_admin may read a decision in full'
      using errcode = '42501';
  end if;

  return query
  select d.id, d.as_of, d.created_at, d.agent_version, d.decision_source, d.symbol,
         d.action, d.summary, d.market_open, d.equity, d.day_pnl, d.llm_model,
         d.llm_reasoning, d.llm_usage, d.evidence, d.strategy_config
    from public.decisions d
   where d.id = p_id;
end;
$$;

revoke all on function public.beleth_decision_detail(uuid) from public, anon;
grant execute on function public.beleth_decision_detail(uuid) to authenticated;
