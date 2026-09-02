-- 0003_anon_read_policies.sql — permissive SELECT policies for the webapp.
--
-- 0001 enabled row level security on every table with zero policies: a
-- deliberate deny-all while only the agent (service-role key, which bypasses
-- RLS) talked to the database. The webapp milestone changes that: the public
-- homepage reads with the anon key, and the product is built on radical
-- transparency — "The account is open for reading." These five tables hold
-- the paper-trading decision log: no personal data, no credentials, every
-- row already meant for the dashboard.
--
-- What this migration does:
--   * adds exactly one permissive SELECT policy per table for the `anon` and
--     `authenticated` roles — the webapp's read path (public homepage now,
--     authenticated dashboard later);
--   * adds NO write policy of any kind — INSERT/UPDATE/DELETE stay denied for
--     anon/authenticated; only the agent's service-role key (which bypasses
--     RLS) writes.
--
-- Deliberately no `revoke` statements: 0001's header comment is explicit that
-- the deny-all is carried by RLS itself and that revoking privileges would
-- silently fight the permissive policies later milestones add — this is the
-- milestone it was left for.

drop policy if exists "anon and authenticated can read decisions" on public.decisions;
create policy "anon and authenticated can read decisions"
    on public.decisions
    for select
    to anon, authenticated
    using (true);

drop policy if exists "anon and authenticated can read risk_checks" on public.risk_checks;
create policy "anon and authenticated can read risk_checks"
    on public.risk_checks
    for select
    to anon, authenticated
    using (true);

drop policy if exists "anon and authenticated can read trades" on public.trades;
create policy "anon and authenticated can read trades"
    on public.trades
    for select
    to anon, authenticated
    using (true);

drop policy if exists "anon and authenticated can read positions" on public.positions;
create policy "anon and authenticated can read positions"
    on public.positions
    for select
    to anon, authenticated
    using (true);

drop policy if exists "anon and authenticated can read agent_status" on public.agent_status;
create policy "anon and authenticated can read agent_status"
    on public.agent_status
    for select
    to anon, authenticated
    using (true);