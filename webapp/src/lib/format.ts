/**
 * How numbers and dates are written across the webapp.
 *
 * There were three parallel money stacks — `formatUsd`/`formatPct` in the dashboard UI
 * kit, `price2`/`fmtPrice`/`signedUsd` in the portfolio page, `usd0`/`usd2`/
 * `formatUsd`/`formatSigned` in the equity curve — and `formatDate` written out
 * byte-identically in two files with four more one-off variants beside it. Six ways of
 * printing a dollar amount is six chances for two panels on the same screen to
 * disagree about a minus sign.
 *
 * `Intl.NumberFormat` instances are built once at module scope: constructing one is
 * expensive, and these run per row.
 *
 * Client-safe: no `server-only`.
 */

const USD_0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const USD_2 = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Nothing to show. One dash, everywhere. */
export const EM_DASH = "—";

/**
 * `$1,234.56`, and `-$364` for a negative — the sign goes outside the symbol, which is
 * how `Intl` renders currency and how every other figure on the page reads.
 * `digits: 0` for axis labels and other tight spaces.
 */
export function formatUsd(
  n: number | null | undefined,
  digits: 0 | 2 = 2,
): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "n/a";
  const body = (digits === 0 ? USD_0 : USD_2).format(Math.abs(n));
  return `${n < 0 ? "-" : ""}$${body}`;
}

/**
 * `+$12.34` / `−$12.34`. The minus is U+2212, which lines up with digits in a
 * proportional font where a hyphen does not.
 */
export function formatSignedUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "n/a";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}$${USD_2.format(Math.abs(n))}`;
}

/** A fraction as a percentage: `formatPct(0.0123)` is `1.23%`. */
export function formatPct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "n/a";
  return `${(n * 100).toFixed(digits)}%`;
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `2 Sep 2026`. */
export function formatDate(iso: string | null | undefined): string {
  const d = parse(iso);
  return d
    ? d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    : EM_DASH;
}

/** `Sep 2, 2026, 02:15 PM`. */
export function formatDateTime(iso: string | null | undefined): string {
  const d = parse(iso);
  return d
    ? d.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : EM_DASH;
}

/** `Wed, Sep 2, 2:15 PM` — for a market calendar, where the weekday is the point. */
export function formatWeekdayTime(iso: string | null | undefined): string {
  const d = parse(iso);
  return d
    ? d.toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : EM_DASH;
}

/** Coarse relative time. Not a clock — "how stale is this". */
export function timeAgo(iso: string | null | undefined): string {
  const d = parse(iso);
  if (!d) return EM_DASH;
  const secs = (Date.now() - d.getTime()) / 1000;
  if (secs < 90) return "just now";
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}
