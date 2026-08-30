/**
 * Client-safe types + helpers for the "Calendar" view (the US market's own
 * trading calendar: which days the exchange is open, regular vs. early close,
 * holidays). The rows come from Alpaca `GET /v2/calendar` via
 * `src/lib/alpaca.ts` (server-only); this module keeps the shapes and the
 * pure classification so a Client Component can import them.
 */

/** One open trading day, as Alpaca reports it. Times are `HH:MM`, US/Eastern. */
export type MarketCalendarDay = {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Opening bell, `HH:MM` — normally `09:30`. */
  open: string;
  /** Closing bell, `HH:MM` — normally `16:00`, `13:00` on an early-close day. */
  close: string;
};

export const REGULAR_OPEN = "09:30";
export const REGULAR_CLOSE = "16:00";

/** True when the session closes before the regular 16:00 bell (half day). */
export function isEarlyClose(d: MarketCalendarDay): boolean {
  return d.close < REGULAR_CLOSE;
}

export type MarketDayKind = "open" | "early" | "closed";

export function classifyDay(
  iso: string,
  dow: number,
  byDate: Map<string, MarketCalendarDay>,
): { kind: MarketDayKind; day: MarketCalendarDay | null } {
  const day = byDate.get(iso) ?? null;
  if (day) return { kind: isEarlyClose(day) ? "early" : "open", day };
  return { kind: "closed", day: null };
}

/** "9:30 AM – 4:00 PM" from two `HH:MM` strings. */
export function sessionRange(open: string, close: string): string {
  return `${to12h(open)} – ${to12h(close)}`;
}

function to12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}
