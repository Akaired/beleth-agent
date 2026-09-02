/**
 * Six ways of printing a dollar amount is six chances for two panels on the same screen
 * to disagree. These pin the one way.
 */
import { describe, expect, it } from "vitest";
import {
  EM_DASH,
  formatDate,
  formatPct,
  formatSignedUsd,
  formatUsd,
  timeAgo,
} from "@/lib/format";

describe("formatUsd", () => {
  it("groups thousands and keeps two decimals", () => {
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(-42)).toBe("$-42.00");
  });

  it("drops the decimals for axis labels", () => {
    expect(formatUsd(1234.56, 0)).toBe("$1,235");
  });

  it("says n/a rather than rendering a non-number", () => {
    for (const v of [null, undefined, NaN]) expect(formatUsd(v)).toBe("n/a");
  });
});

describe("formatSignedUsd", () => {
  it("signs the value and drops the sign at zero", () => {
    expect(formatSignedUsd(12.3)).toBe("+$12.30");
    expect(formatSignedUsd(0)).toBe("$0.00");
  });

  it("uses a real minus sign, which lines up with digits", () => {
    expect(formatSignedUsd(-12.3)).toBe("−$12.30");
    expect(formatSignedUsd(-12.3).startsWith("-")).toBe(false);
  });

  it("says n/a rather than rendering a non-number", () => {
    expect(formatSignedUsd(null)).toBe("n/a");
  });
});

describe("formatPct", () => {
  it("takes a fraction, not a percentage", () => {
    expect(formatPct(0.0123)).toBe("1.23%");
    expect(formatPct(1)).toBe("100.00%");
    expect(formatPct(0.5, 0)).toBe("50%");
  });
});

describe("formatDate", () => {
  it("renders an em dash for nothing, and for an unparseable value", () => {
    expect(formatDate(null)).toBe(EM_DASH);
    expect(formatDate("")).toBe(EM_DASH);
    expect(formatDate("not a date")).toBe(EM_DASH);
  });

  it("renders a date", () => {
    expect(formatDate("2026-09-02T14:00:00Z")).toMatch(/Sep\s+2,\s+2026/);
  });
});

describe("timeAgo", () => {
  it("is coarse on purpose — it answers how stale, not what time", () => {
    const ago = (secs: number) => new Date(Date.now() - secs * 1000).toISOString();
    expect(timeAgo(ago(10))).toBe("just now");
    expect(timeAgo(ago(600))).toBe("10m ago");
    expect(timeAgo(ago(7200))).toBe("2h ago");
    expect(timeAgo(ago(86_400 * 3))).toBe("3d ago");
    expect(timeAgo(null)).toBe(EM_DASH);
  });
});
