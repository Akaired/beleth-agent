-- 0035_column_grants_on_the_public_read_path.sql
--
-- ⚠️ APPLY ONLY TOGETHER WITH THE WEBAPP DEPLOY that contains `fetchDecisionDetail`
--    reading through `beleth_decision_detail` (0034) and a `restCount` that names a
--    column. Applied ahead of that deploy it breaks the live homepage: PostgREST
--    defaults a count request to `select=*`, which stops being permitted here. This
--    was confirmed against production, not reasoned about — the revoke was applied,
--    the homepage count returned 42501, and it was rolled back within the minute.
--
-- `decisions.llm_reasoning` is the model's unedited output. The dashboard shows it to
-- demo_admin and above and the UI hides it from everyone else — but the table is
-- readable by `anon` and `authenticated` (0003), so the hiding was cosmetic: the anon
-- key and one PostgREST call returned it to anybody.
--
-- RLS has no column granularity; GRANTs do, and they compose with the policy. The
-- column leaves the public read path, and 0034's `beleth_decision_detail` becomes the
-- only way to read it — gated to demo_admin and master_admin in the database.
--
-- `evidence` and `strategy_config` deliberately stay public. They are the transparency
-- artifact this project is judged on: the evidence package is what the public homepage
-- reads to explain a no-trade, and the config snapshot is the same content as the
-- committed config/strategy.yaml. Publishing them is the point.
--
-- Idempotent.

-- A column-level REVOKE is inert while the role holds SELECT on the whole table (see
-- 0034): the table privilege comes off, and every column except `llm_reasoning` is
-- granted back by name. A column added to `decisions` later is invisible to the public
-- read path until it is named here — deliberately fail-closed.
revoke select on public.decisions from anon, authenticated;
grant select (
    id, as_of, created_at, agent_version, decision_source, symbol, action, summary,
    market_open, equity, day_pnl, llm_model, llm_usage, evidence, strategy_config
) on public.decisions to anon, authenticated;

-- ── the broker dumps leave the public read path ─────────────────────────────
-- `trades.raw` and `positions.raw` are the full Alpaca order and position dumps —
-- broker-side identifiers, account-linked fields, whatever the SDK returned. Nothing
-- in the webapp selects either column; every read names its columns.
-- Note the shape: a column-level REVOKE is inert while the role still holds SELECT on
-- the whole table, which anon and authenticated do by default on this project. The
-- table privilege has to come off first, and the wanted columns be granted back by
-- name. That also makes the default fail-closed: a column added later is invisible
-- until it is named here.
revoke select on public.trades from anon, authenticated;
grant select (
    id, decision_id, created_at, underlying, alpaca_order_id, client_order_id,
    status, qty, filled_qty, filled_avg_price, legs, credit, max_loss,
    submitted_at, filled_at, kind, exit_reason
) on public.trades to anon, authenticated;

revoke select on public.positions from anon, authenticated;
grant select (
    symbol, first_seen_at, updated_at, qty, side, avg_entry_price, market_value,
    cost_basis, unrealized_pl, asset_class
) on public.positions to anon, authenticated;

