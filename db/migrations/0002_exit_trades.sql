-- Beleth agent — migration 0002: exits (R5).
--
-- Applied like 0001 (Supabase dashboard SQL Editor, or the Management API query
-- endpoint). Idempotent: safe to re-run.
--
-- R5 closes open spreads. Those closings are first-class trades rows (constraint #3),
-- marked so the dashboard can tell an entry from an exit at a glance:
--
--   kind         'entry' (default — every pre-existing row) | 'exit'
--   exit_reason  why the position was closed: 'profit_target' | 'loss_credit_multiple'
--                | 'short_leg_itm'; NULL on entries (and on failed exit submissions
--                the reason still applies, so it is set whenever an exit was attempted)

alter table public.trades
    add column if not exists kind text not null default 'entry';

alter table public.trades
    add column if not exists exit_reason text;

create index if not exists idx_trades_kind on public.trades (kind);