/**
 * Pure calendar-grid maths, shared by the market calendar and the trade
 * calendar. Client-safe — no server-only imports. Everything is computed in
 * UTC on `Date.UTC(...)` so the grid never shifts under the runner's timezone;
 * the day *labels* are plain `YYYY-MM-DD` strings and the callers bucket their
 * data into the same string space (see `nyDateKey`).
 */

export type GridDay = {
  /** `YYYY-MM-DD`. */
  iso: string;
  /** Day of month, 1–31. */
  day: number;
  /** False for the leading/trailing days borrowed from the adjacent months. */
  inMonth: boolean;
  /** 0 = Sunday … 6 = Saturday. */
  dow: number;
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthLabel(year: number, month0: number): string {
  return `${MONTH_NAMES[month0]} ${year}`;
}

/** `{ year, month0 }` shifted by `delta` whole months. */
export function shiftMonth(
  year: number,
  month0: number,
  delta: number,
): { year: number; month0: number } {
  const m = month0 + delta;
  return {
    year: year + Math.floor(m / 12),
    month0: ((m % 12) + 12) % 12,
  };
}

/** `YYYY-MM` ⇒ `{ year, month0 }`, or null when malformed. */
export function parseMonthParam(
  v: string | null | undefined,
): { year: number; month0: number } | null {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  if (!m) return null;
  const year = Number(m[1]);
  const month0 = Number(m[2]) - 1;
  if (month0 < 0 || month0 > 11) return null;
  return { year, month0 };
}

export function monthParam(year: number, month0: number): string {
  return `${year}-${String(month0 + 1).padStart(2, "0")}`;
}

/** Today's date in the US market timezone, as `{ year, month0, iso }`. */
export function nyToday(now: Date = new Date()): {
  year: number;
  month0: number;
  iso: string;
} {
  const iso = nyDateKey(now); // YYYY-MM-DD
  const [y, m] = iso.split("-").map(Number);
  return { year: y, month0: m - 1, iso };
}

/** Bucket an instant into a `YYYY-MM-DD` key in the US market timezone. */
export function nyDateKey(when: Date | string): string {
  const d = typeof when === "string" ? new Date(when) : when;
  // en-CA renders as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
  }).format(d);
}

/**
 * Weeks (Sunday-first) covering `month0`/`year`, with the leading and trailing
 * days of the neighbouring months filled in. Trailing all-out weeks are
 * dropped, so the grid is 4–6 rows tall like a wall calendar.
 */
export function monthMatrix(year: number, month0: number): GridDay[][] {
  const firstDow = new Date(Date.UTC(year, month0, 1)).getUTCDay();
  const cursor = new Date(Date.UTC(year, month0, 1 - firstDow));

  const weeks: GridDay[][] = [];
  for (let w = 0; w < 6; w += 1) {
    const row: GridDay[] = [];
    for (let d = 0; d < 7; d += 1) {
      row.push({
        iso: cursor.toISOString().slice(0, 10),
        day: cursor.getUTCDate(),
        inMonth: cursor.getUTCMonth() === month0,
        dow: cursor.getUTCDay(),
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(row);
  }
  return weeks.filter((wk) => wk.some((d) => d.inMonth));
}

/** First and last `YYYY-MM-DD` of a month matrix, for a data-fetch window. */
export function matrixRange(year: number, month0: number): {
  start: string;
  end: string;
} {
  const weeks = monthMatrix(year, month0);
  return {
    start: weeks[0][0].iso,
    end: weeks[weeks.length - 1][6].iso,
  };
}
