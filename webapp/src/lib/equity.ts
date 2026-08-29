/**
 * Client-safe types and constants for the equity curve. The server-only
 * Alpaca reader (`src/lib/alpaca.ts`) builds these; the chart component and
 * the `/api/equity` client fetch consume them. Kept separate so importing the
 * shared shape into a client component never drags in `server-only`.
 */

export const EQUITY_RANGES = ["1D", "1W", "1M", "ALL"] as const;
export type EquityRange = (typeof EQUITY_RANGES)[number];

/** The range the pages request for their first server render. */
export const DEFAULT_EQUITY_RANGE: EquityRange = "1W";

export function isEquityRange(value: string | null): value is EquityRange {
  return value !== null && (EQUITY_RANGES as readonly string[]).includes(value);
}

/** One point on the curve. `time` is a Unix timestamp in **seconds** (lightweight-charts `UTCTimestamp`). */
export type EquityBar = { time: number; value: number };

/**
 * A *filled* order overlaid on the equity curve. We never plot resting,
 * canceled, expired or rejected orders — only fills, split by what they did:
 *  - `open`   — a filled entry whose legs are still in the account
 *  - `closed` — a filled entry that has since been exited (round-trip)
 *  - `exit`   — a filled closing order
 */
export type TradeMarkerState = "open" | "closed" | "exit";

export type TradeLegFill = { strike: number; price: number | null };

export type TradeMarker = {
  /** Fill time — Unix seconds (lightweight-charts `UTCTimestamp`). */
  time: number;
  filledAt: string;
  state: TradeMarkerState;
  underlying: string;
  right: "C" | "P" | null;
  qty: number | null;
  /** Order-level net fill (signed as Alpaca reports it: negative = net credit). */
  net: number | null;
  shortLeg: TradeLegFill | null;
  longLeg: TradeLegFill | null;
  /** e.g. "bull put 741 / 740 P". */
  spread: string | null;
};

export function spreadLabel(
  right: "C" | "P" | null,
  shortStrike: number | null,
  longStrike: number | null,
): string | null {
  if (right === null || shortStrike === null || longStrike === null) return null;
  const name =
    right === "C"
      ? shortStrike < longStrike
        ? "bear call"
        : "bull call"
      : shortStrike > longStrike
        ? "bull put"
        : "bear put";
  return `${name} ${shortStrike} / ${longStrike} ${right}`;
}

export type MarketClock = {
  isOpen: boolean;
  nextOpen: string | null;
  nextClose: string | null;
};

/**
 * Live account balances from Alpaca `/v2/account` — the single source of truth
 * for "right now". `portfolio/history` only has completed market-hours bars, so
 * its last point lags the account (and disagrees over weekends); the chart
 * appends this value as its final point and the overview reads its numbers here
 * so the two always agree.
 */
export type AccountSnapshot = {
  equity: number;
  /** Previous trading day's closing equity (Alpaca `last_equity`). */
  lastEquity: number;
  /** `equity - lastEquity`. */
  dayPnl: number;
  dayPnlPct: number;
  asOf: string;
};

export type EquityHistory = {
  range: EquityRange;
  /** Ascending, strictly increasing `time`, leading pre-funding zeros stripped. */
  points: EquityBar[];
  /** Account base value for the window (Alpaca `base_value`) — the cost basis the P&L is measured from. */
  baseValue: number;
  /** Equity at the first / last point of the returned window. */
  startEquity: number;
  lastEquity: number;
  /** Change across the window. */
  changeAbs: number;
  changePct: number;
  /** True while intraday buckets are in use — the chart shows time-of-day on the axis. */
  intraday: boolean;
};
