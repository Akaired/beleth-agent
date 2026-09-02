/**
 * `taperMultiplier` exists so the dashboard can draw the R9 curve. It must agree
 * with `vix_size_multiplier` in app/risk_check.py — a chart that disagrees with the
 * agent is worse than no chart. The cases below are the same boundaries the Python
 * unit tests pin, transcribed.
 */
import { describe, expect, it } from "vitest";
import { readVixTaper, taperMultiplier, type VixTaper } from "@/lib/strategy-schema";

// The values live on the private host in config/strategy.yaml.
const LIVE: VixTaper = {
  upperPct: 25,
  lowerPct: 3,
  floorFrac: 0.5,
  blockBelowPct: 3,
  enabled: true,
};

describe("taperMultiplier", () => {
  it("is full size at or above the ceiling", () => {
    expect(taperMultiplier(25, LIVE)).toBe(1);
    expect(taperMultiplier(90, LIVE)).toBe(1);
  });

  it("hard-blocks strictly below the block floor", () => {
    expect(taperMultiplier(2.9, LIVE)).toBe(0);
    expect(taperMultiplier(3, LIVE)).not.toBe(0);
  });

  it("interpolates in a straight line between floor and ceiling", () => {
    const mid = taperMultiplier(14, LIVE);
    expect(mid).toBeGreaterThan(LIVE.floorFrac);
    expect(mid).toBeLessThan(1);
    expect(mid).toBeCloseTo(0.5 + 0.5 * ((14 - 3) / (25 - 3)), 10);
  });

  it("holds the floor between the lower and block thresholds", () => {
    const t = { ...LIVE, lowerPct: 5, blockBelowPct: 3 };
    expect(taperMultiplier(4, t)).toBe(0.5);
  });

  it("is inert when no band is configured", () => {
    const off: VixTaper = {
      upperPct: 0,
      lowerPct: 0,
      floorFrac: 1,
      blockBelowPct: 0,
      enabled: false,
    };
    expect(taperMultiplier(0, off)).toBe(1);
    expect(taperMultiplier(50, off)).toBe(1);
  });

  it("is inert when the band is inverted, matching the Python branch order", () => {
    const inverted: VixTaper = { ...LIVE, upperPct: 10, lowerPct: 20, blockBelowPct: 0 };
    expect(taperMultiplier(5, inverted)).toBe(1);
  });
});

describe("readVixTaper", () => {
  it("returns null when the config carries no vix_regime block", () => {
    expect(readVixTaper(null)).toBeNull();
    expect(readVixTaper({ entry: {} })).toBeNull();
  });

  it("reads the live shape and reports it as enabled", () => {
    const t = readVixTaper({
      entry: {
        vix_regime: {
          taper_upper_pct: 25,
          taper_lower_pct: 3,
          taper_floor_frac: 0.5,
          block_below_pct: 3,
        },
      },
    });
    expect(t).toEqual(LIVE);
  });

  it("treats an all-zero block as configured-but-off", () => {
    const t = readVixTaper({
      entry: {
        vix_regime: {
          taper_upper_pct: 0,
          taper_lower_pct: 0,
          taper_floor_frac: 1,
          block_below_pct: 0,
        },
      },
    });
    expect(t?.enabled).toBe(false);
  });
});
