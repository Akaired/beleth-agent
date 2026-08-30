/**
 * Client-safe types + builder for the "Trade calendar" view — the month grid
 * traders keep, one cell per day showing how many spreads closed that day and
 * the realised P&L, with a weekly total column and a month total.
 *
 * The daily aggregates come from `fetchTradeCalendar` in
 * `src/lib/dashboard-queries.ts`, which reconstructs closed round-trips from
 * the Alpaca paper account (our tables do not keep that history — see
 * `src/lib/positions.ts`). A "trade" here is one closed vertical spread; the
 * day it lands on is the exit-fill date in US/Eastern.
 */
import {
  monthMatrix,
  type GridDay,
} from "@/lib/month-grid";

/** Per-day roll-up: `date` is `YYYY-MM-DD` (US/Eastern). */
export type TradeCalendarDay = {
  date: string;
  trades: number;
  realizedPnl: number;
};

export type TradeCalendarCell = GridDay & {
  trades: number;
  realizedPnl: number;
  isToday: boolean;
};

export type TradeCalendarWeek = {
  cells: TradeCalendarCell[];
  trades: number;
  realizedPnl: number;
};

export type TradeCalendarMonth = {
  year: number;
  month0: number;
  weeks: TradeCalendarWeek[];
  /** In-month totals only (borrowed adjacent-month days are excluded). */
  totalTrades: number;
  totalPnl: number;
  /** In-month days that had at least one closed trade. */
  activeDays: number;
  winningDays: number;
  losingDays: number;
};

/**
 * Fold the flat daily aggregates into a Sunday-first month grid with weekly
 * and monthly totals. Days with no data render as empty cells (0 trades,
 * $0.00) exactly like a trader's paper calendar.
 */
export function buildTradeCalendar(
  days: TradeCalendarDay[],
  year: number,
  month0: number,
  todayIso: string,
): TradeCalendarMonth {
  const byDate = new Map<string, TradeCalendarDay>();
  for (const d of days) byDate.set(d.date, d);

  let totalTrades = 0;
  let totalPnl = 0;
  let activeDays = 0;
  let winningDays = 0;
  let losingDays = 0;

  const weeks: TradeCalendarWeek[] = monthMatrix(year, month0).map((row) => {
    let wTrades = 0;
    let wPnl = 0;
    const cells: TradeCalendarCell[] = row.map((g) => {
      const agg = byDate.get(g.iso);
      const trades = agg?.trades ?? 0;
      const realizedPnl = agg?.realizedPnl ?? 0;
      if (g.inMonth) {
        wTrades += trades;
        wPnl += realizedPnl;
        if (trades > 0) {
          activeDays += 1;
          if (realizedPnl > 0) winningDays += 1;
          else if (realizedPnl < 0) losingDays += 1;
        }
      }
      return { ...g, trades, realizedPnl, isToday: g.iso === todayIso };
    });
    totalTrades += wTrades;
    totalPnl += wPnl;
    return { cells, trades: wTrades, realizedPnl: wPnl };
  });

  return {
    year,
    month0,
    weeks,
    totalTrades,
    totalPnl,
    activeDays,
    winningDays,
    losingDays,
  };
}
