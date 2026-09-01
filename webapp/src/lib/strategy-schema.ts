/**
 * Annotation layer for the strategy-config snapshot.
 *
 * `config/strategy.yaml` reaches the webapp as parsed JSON on every decision
 * row (`decisions.strategy_config`) — the inline comments that explain each
 * value are lost in the parse. This module puts them back: a human label, a
 * one-line gloss, a unit-aware formatter and the operating rule (R1–R11) each
 * parameter serves, keyed by dotted path.
 *
 * It is deliberately decoupled from the agent. Any key the agent adds that is
 * not described here still renders — it falls through to a prettified label in
 * the "Other parameters" section, so nothing is ever hidden.
 */

export type ParamRow = {
  path: string;
  label: string;
  gloss?: string;
  rule?: string;
  value: string;
};

export type SectionId =
  | "entry"
  | "regime"
  | "risk"
  | "exit"
  | "execution"
  | "inputs"
  | "operations"
  | "other";

export type StrategySection = {
  id: SectionId;
  title: string;
  icon: string;
  blurb: string;
  rules: string[];
  /** de-emphasised sections render inside a collapsed <details> */
  secondary?: boolean;
  rows: ParamRow[];
};

type Fmt = (v: unknown) => string;

const asNum = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const F = {
  plain: (v: unknown) => String(v),
  pct: (v: unknown) => (asNum(v) === null ? String(v) : `${v}%`),
  pctile: (v: unknown) => (asNum(v) === null ? String(v) : `${v}th pct`),
  volpts: (v: unknown) => (asNum(v) === null ? String(v) : `${v} vol pts`),
  usd: (v: unknown) =>
    asNum(v) === null ? String(v) : `$${(v as number).toFixed(2)}`,
  mult: (v: unknown) => (asNum(v) === null ? String(v) : `${v}×`),
  ratio: (v: unknown) => (asNum(v) === null ? String(v) : `${v}`),
  days: (v: unknown) => (asNum(v) === null ? String(v) : `${v} d`),
  minutes: (v: unknown) => (asNum(v) === null ? String(v) : `${v} min`),
  seconds: (v: unknown) => (asNum(v) === null ? String(v) : `${v} s`),
  bytes: (v: unknown) => {
    const n = asNum(v);
    return n === null ? String(v) : `${(n / 1_000_000).toFixed(1)} MB`;
  },
  bool: (v: unknown) => (v ? "enabled" : "disabled"),
  onoff: (v: unknown) => (v ? "on" : "off"),
  list: (v: unknown) => (Array.isArray(v) ? v.join("  /  ") : String(v)),
  url: (v: unknown) => String(v),
} satisfies Record<string, Fmt>;

type Meta = { label: string; gloss?: string; rule?: string; fmt?: Fmt };

/** path → annotation */
const META: Record<string, Meta> = {
  "universe.symbols": {
    label: "Underlyings",
    gloss:
      "Highly liquid ETFs only — a tight bid/ask is what makes a paper fill realistic.",
    fmt: F.list,
  },

  // ── entry gate ────────────────────────────────────────────────
  "tenor_scan.dte_ladder": {
    label: "DTE ladder",
    gloss:
      "Days-to-expiry scanned each cycle. There is no fixed expiry — the agent trades only the one tenor whose premium clears the bar.",
    rule: "R1",
    fmt: F.list,
  },
  "tenor_scan.vrp_threshold_vol_points": {
    label: "VRP threshold",
    gloss:
      "Minimum volatility risk premium (that tenor's ATM IV minus 20-day realized vol), in annualised vol points, for the tenor to be tradable.",
    rule: "R1",
    fmt: F.volpts,
  },
  "tenor_scan.atm_strike_tolerance_pct": {
    label: "ATM tolerance",
    gloss:
      "How close to spot a strike must sit to count as at-the-money for tenor-IV and term-structure math.",
    fmt: F.pct,
  },
  "structure.short_leg_delta_min": {
    label: "Short-leg delta — floor",
    gloss:
      "Lower bound for the sold strike on the delta curve — roughly its chance of finishing in the money. Industry convention (B3).",
    rule: "R1",
    fmt: F.ratio,
  },
  "structure.short_leg_delta_max": {
    label: "Short-leg delta — cap",
    gloss: "Upper bound for the sold strike's delta.",
    rule: "R1",
    fmt: F.ratio,
  },
  "structure.strike_width_usd_min": {
    label: "Spread width — min",
    gloss:
      "Distance between the two strikes. Width × 100 − credit is the defined max loss per contract.",
    rule: "R4",
    fmt: F.usd,
  },
  "structure.strike_width_usd_max": {
    label: "Spread width — max",
    gloss: "Widest spread the agent will build.",
    rule: "R4",
    fmt: F.usd,
  },

  // ── regime & event filters ───────────────────────────────────
  "regime.term_structure_flat_band_iv": {
    label: "Flat band",
    gloss:
      "|short-tenor ATM IV − long-tenor ATM IV| below this reads as a flat term structure — neither contango nor backwardation.",
    rule: "R2",
    fmt: F.ratio,
  },
  "regime.block_new_shorts_on_backwardation": {
    label: "Backwardation block",
    gloss:
      "When the term structure inverts (stress), open nothing new. Contango is never treated as a signal (A5).",
    rule: "R2",
    fmt: F.bool,
  },
  "entry.vix_regime.taper_upper_pct": {
    label: "Taper — full size at/above",
    gloss: "VIX 1-year percentile at or above which trades are full size.",
    rule: "R9",
    fmt: F.pctile,
  },
  "entry.vix_regime.taper_lower_pct": {
    label: "Taper — floor at/below",
    gloss:
      "Percentile at or below which per-trade size is held at the floor multiplier.",
    rule: "R9",
    fmt: F.pctile,
  },
  "entry.vix_regime.taper_floor_frac": {
    label: "Taper floor",
    gloss: "Size multiplier at the low end of the range (0.5 = half size).",
    rule: "R9",
    fmt: F.mult,
  },
  "entry.vix_regime.block_below_pct": {
    label: "Hard block below",
    gloss:
      "Strictly below this percentile: no new entry at all, surfaced as an R9 rejection row.",
    rule: "R9",
    fmt: F.pctile,
  },
  "macro_calendar.block_within_days": {
    label: "Event blackout",
    gloss:
      "No new position whose expiry falls on or after a known macro event within this many days.",
    rule: "R3",
    fmt: F.days,
  },
  "macro_calendar.events_file": {
    label: "Event list",
    gloss:
      "Hand-maintained for the hackathon window — no calendar-provider integration.",
    rule: "R3",
    fmt: F.plain,
  },

  // ── risk limits ──────────────────────────────────────────────
  "risk.max_risk_per_trade_pct_of_equity": {
    label: "Max risk per trade",
    gloss:
      "Hard cap on a single spread's defined max loss, as a share of equity. Quantity is sized down to fit.",
    rule: "R6",
    fmt: F.pct,
  },
  "risk.max_concurrent_positions": {
    label: "Max open positions",
    gloss: "Ceiling on simultaneously open spreads.",
    rule: "R6",
    fmt: F.plain,
  },
  "risk.daily_drawdown_stop_pct": {
    label: "Daily drawdown stop",
    gloss:
      "Intraday loss past this: stop opening new positions until the next session.",
    rule: "R7",
    fmt: F.pct,
  },
  "risk.max_aggregate_risk_pct_of_equity": {
    label: "Aggregate risk cap",
    gloss:
      "Committed max loss across all open spreads plus a new candidate must stay within this. SPY and QQQ are ~0.95 correlated, so exposure counts as one short-vol bet. 0 disables.",
    rule: "R11",
    fmt: F.pct,
  },

  // ── exit rules ───────────────────────────────────────────────
  "exit.profit_target_pct_of_max_credit": {
    label: "Profit target",
    gloss:
      "Close once this share of the max credit is captured — do not wait for expiry.",
    rule: "R5",
    fmt: F.pct,
  },
  "exit.loss_close_credit_multiple": {
    label: "Loss stop",
    gloss:
      "Close when the cost to buy the spread back reaches this multiple of the credit received.",
    rule: "R5",
    fmt: F.mult,
  },
  "exit.loss_close_on_short_leg_itm": {
    label: "Short-leg ITM exit",
    gloss:
      "Close immediately if the short strike goes in-the-money, whatever the mark-to-market says.",
    rule: "R5",
    fmt: F.bool,
  },
  "exit.close_slippage_usd": {
    label: "Exit slippage",
    gloss:
      "Per-share concession on a closing order — wider than the entry concession on purpose: a protective close that rests unfilled is worse than paying for liquidity.",
    rule: "R5",
    fmt: F.usd,
  },

  // ── execution & pricing ──────────────────────────────────────
  "structure.credit_slippage_usd": {
    label: "Entry slippage — floor",
    gloss:
      "Absolute per-share concession below mid the entry limit will always accept.",
    rule: "R4",
    fmt: F.usd,
  },
  "structure.credit_slippage_frac_of_spread": {
    label: "Entry slippage — spread fraction",
    gloss:
      "Walks the limit this far from mid toward the near touch (0.5 = halfway to the bid). The concession used is the larger of this and the floor.",
    rule: "R4",
    fmt: F.ratio,
  },
  "structure.max_slippage_frac_of_credit": {
    label: "Marketability cap",
    gloss:
      "If being marketable would concede more than this fraction of the measured credit, the cycle does not trade and logs why. 0 disables.",
    rule: "R4",
    fmt: F.ratio,
  },

  // ── measurement inputs ───────────────────────────────────────
  "vix.fred_series_id": {
    label: "VIX series",
    gloss:
      "FRED VIXCLS — the CBOE VIX close. Never sourced from Alpaca (no index data) and never an ETF proxy.",
    fmt: F.plain,
  },
  "vix.fred_csv_url": {
    label: "FRED endpoint",
    gloss: "Primary source. Free, no API key.",
    fmt: F.url,
  },
  "vix.cboe_fallback_url": {
    label: "CBOE fallback",
    gloss: "The same history, used only when FRED is unreachable.",
    fmt: F.url,
  },
  "vix.lookback_trading_days": {
    label: "Percentile lookback",
    gloss: "Trailing window for the VIX 1-year percentile and rank.",
    fmt: F.days,
  },
  "realized_vol.windows_days": {
    label: "Realized-vol windows",
    gloss:
      "Close-to-close annualised realized volatility is computed over each of these day counts.",
    fmt: F.list,
  },
  "realized_vol.annualization_trading_days": {
    label: "Annualisation basis",
    gloss: "Trading days per year used to annualise realized vol.",
    fmt: F.plain,
  },

  // ── operations ───────────────────────────────────────────────
  "runner.open_cycle_interval_minutes": {
    label: "Cycle cadence — market open",
    gloss: "How often a full decision cycle runs while the market is open.",
    fmt: F.minutes,
  },
  "runner.closed_heartbeat_interval_minutes": {
    label: "Heartbeat — market closed",
    gloss:
      "Outside hours the loop only writes a heartbeat, so the dashboard can tell 'alive, closed' from 'agent down'.",
    fmt: F.minutes,
  },
  "runner.pause_poll_seconds": {
    label: "Pause poll",
    gloss:
      "How often the kill switch (agent_status.paused, never written by the agent) is re-read while paused.",
    fmt: F.seconds,
  },
  "runner.cycle_timeout_seconds": {
    label: "Cycle timeout",
    gloss: "A cycle slower than this is killed and the loop moves on.",
    fmt: F.seconds,
  },
  "runner.diagnostic_log.enabled": {
    label: "Diagnostic log",
    gloss:
      "Mirror stdout/stderr to a rotating on-disk file so the narrative survives a container recreate.",
    fmt: F.bool,
  },
  "runner.diagnostic_log.dir": { label: "Log directory", fmt: F.plain },
  "runner.diagnostic_log.filename": { label: "Log file", fmt: F.plain },
  "runner.diagnostic_log.max_bytes": {
    label: "Log rotation size",
    fmt: F.bytes,
  },
  "runner.diagnostic_log.backup_count": {
    label: "Log backups kept",
    fmt: F.plain,
  },
};

type SectionDef = {
  id: SectionId;
  title: string;
  icon: string;
  blurb: string;
  rules: string[];
  secondary?: boolean;
  paths: string[];
};

const SECTION_DEFS: SectionDef[] = [
  {
    id: "entry",
    title: "Entry gate",
    icon: "target",
    blurb:
      "What has to be true before a spread is even a candidate: a paid-for premium on the tenor, a liquid underlying, a defined-risk shape.",
    rules: ["R1", "R8"],
    paths: [
      "tenor_scan.vrp_threshold_vol_points",
      "tenor_scan.dte_ladder",
      "tenor_scan.atm_strike_tolerance_pct",
      "structure.short_leg_delta_min",
      "structure.short_leg_delta_max",
      "structure.strike_width_usd_min",
      "structure.strike_width_usd_max",
      "universe.symbols",
    ],
  },
  {
    id: "regime",
    title: "Regime & event filters",
    icon: "broadcast",
    blurb:
      "Top-down vetoes and size dials. The term structure and the macro calendar can block; the VIX percentile tapers size before it blocks.",
    rules: ["R2", "R3", "R9"],
    paths: [
      "regime.block_new_shorts_on_backwardation",
      "regime.term_structure_flat_band_iv",
      "entry.vix_regime.taper_upper_pct",
      "entry.vix_regime.taper_lower_pct",
      "entry.vix_regime.taper_floor_frac",
      "entry.vix_regime.block_below_pct",
      "macro_calendar.block_within_days",
      "macro_calendar.events_file",
    ],
  },
  {
    id: "risk",
    title: "Risk limits",
    icon: "scales",
    blurb:
      "The hard ceilings. Each is a persisted risk-check the order must pass before it reaches Alpaca.",
    rules: ["R6", "R7", "R11"],
    paths: [
      "risk.max_risk_per_trade_pct_of_equity",
      "risk.max_concurrent_positions",
      "risk.daily_drawdown_stop_pct",
      "risk.max_aggregate_risk_pct_of_equity",
    ],
  },
  {
    id: "exit",
    title: "Exit rules",
    icon: "exit",
    blurb:
      "Mechanical, never LLM-gated. Every cycle the open legs are paired back into spreads and measured against these targets.",
    rules: ["R5"],
    paths: [
      "exit.profit_target_pct_of_max_credit",
      "exit.loss_close_credit_multiple",
      "exit.loss_close_on_short_leg_itm",
      "exit.close_slippage_usd",
    ],
  },
  {
    id: "execution",
    title: "Execution & pricing",
    icon: "trades",
    blurb:
      "A mid quote is an indication, not a fillable price. These control how far the limit walks toward the touch — and when it is cheaper to not trade at all.",
    rules: ["R4"],
    paths: [
      "structure.credit_slippage_usd",
      "structure.credit_slippage_frac_of_spread",
      "structure.max_slippage_frac_of_credit",
    ],
  },
  {
    id: "inputs",
    title: "Measurement inputs",
    icon: "data",
    blurb:
      "Where the numbers the rules gate on come from. The VIX is a regime read, not a proxy for the traded contracts' IV.",
    rules: [],
    secondary: true,
    paths: [
      "vix.fred_series_id",
      "vix.fred_csv_url",
      "vix.cboe_fallback_url",
      "vix.lookback_trading_days",
      "realized_vol.windows_days",
      "realized_vol.annualization_trading_days",
    ],
  },
  {
    id: "operations",
    title: "Runner & operations",
    icon: "data",
    blurb:
      "The resident loop on the agent host. Not strategy — cadence, timeouts and diagnostics.",
    rules: [],
    secondary: true,
    paths: [
      "runner.open_cycle_interval_minutes",
      "runner.closed_heartbeat_interval_minutes",
      "runner.pause_poll_seconds",
      "runner.cycle_timeout_seconds",
      "runner.diagnostic_log.enabled",
      "runner.diagnostic_log.dir",
      "runner.diagnostic_log.filename",
      "runner.diagnostic_log.max_bytes",
      "runner.diagnostic_log.backup_count",
    ],
  },
];

/** Flatten a nested config into dotted paths. Arrays are treated as leaves. */
function flatten(
  obj: unknown,
  prefix = "",
  out: Map<string, unknown> = new Map(),
): Map<string, unknown> {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flatten(v, path, out);
      else out.set(path, v);
    }
  } else if (prefix) {
    out.set(prefix, obj);
  }
  return out;
}

function prettifyLast(path: string): string {
  const last = path.split(".").pop() ?? path;
  return last.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function inferFmt(v: unknown): Fmt {
  if (Array.isArray(v)) return F.list;
  if (typeof v === "boolean") return F.bool;
  return F.plain;
}

function buildRow(path: string, raw: unknown): ParamRow {
  const meta = META[path];
  const fmt = meta?.fmt ?? inferFmt(raw);
  return {
    path,
    label: meta?.label ?? prettifyLast(path),
    gloss: meta?.gloss,
    rule: meta?.rule,
    value: fmt(raw),
  };
}

/**
 * Turn a raw strategy-config snapshot into the ordered, annotated sections the
 * page renders. Anything not claimed by a section lands in "Other parameters".
 */
export function buildStrategyView(
  config: Record<string, unknown> | null,
): StrategySection[] {
  if (!config) return [];
  const flat = flatten(config);
  const claimed = new Set<string>();
  const sections: StrategySection[] = [];

  for (const def of SECTION_DEFS) {
    const rows: ParamRow[] = [];
    for (const p of def.paths) {
      if (!flat.has(p)) continue;
      claimed.add(p);
      rows.push(buildRow(p, flat.get(p)));
    }
    if (rows.length === 0) continue;
    sections.push({
      id: def.id,
      title: def.title,
      icon: def.icon,
      blurb: def.blurb,
      rules: def.rules,
      secondary: def.secondary,
      rows,
    });
  }

  const leftover = [...flat.keys()].filter((p) => !claimed.has(p)).sort();
  if (leftover.length) {
    sections.push({
      id: "other",
      title: "Other parameters",
      icon: "data",
      blurb:
        "Present in the snapshot but not yet annotated here — shown raw so nothing is hidden.",
      rules: [],
      secondary: true,
      rows: leftover.map((p) => buildRow(p, flat.get(p))),
    });
  }

  return sections;
}

/** VIX-taper geometry for the inline curve, read straight off the snapshot. */
export type VixTaper = {
  upperPct: number;
  lowerPct: number;
  floorFrac: number;
  blockBelowPct: number;
  enabled: boolean;
};

export function readVixTaper(
  config: Record<string, unknown> | null,
): VixTaper | null {
  const vr = (config?.entry as Record<string, unknown> | undefined)
    ?.vix_regime as Record<string, unknown> | undefined;
  if (!vr) return null;
  const upperPct = Number(vr.taper_upper_pct) || 0;
  const lowerPct = Number(vr.taper_lower_pct) || 0;
  const floorFrac =
    vr.taper_floor_frac === undefined ? 1 : Number(vr.taper_floor_frac);
  const blockBelowPct = Number(vr.block_below_pct) || 0;
  const enabled = upperPct > 0 || blockBelowPct > 0 || floorFrac < 1;
  return { upperPct, lowerPct, floorFrac, blockBelowPct, enabled };
}

/** Size multiplier for a given VIX 1y percentile under a taper. */
export function taperMultiplier(pct: number, t: VixTaper): number {
  if (t.blockBelowPct > 0 && pct < t.blockBelowPct) return 0;
  if (pct >= t.upperPct) return 1;
  if (pct <= t.lowerPct) return t.floorFrac;
  const span = t.upperPct - t.lowerPct;
  if (span <= 0) return t.floorFrac;
  return t.floorFrac + (1 - t.floorFrac) * ((pct - t.lowerPct) / span);
}

/** One-paragraph plain-language summary, templated from the live snapshot. */
export function describeStrategy(
  config: Record<string, unknown> | null,
): string {
  if (!config) return "";
  const flat = flatten(config);
  const g = (p: string) => flat.get(p);
  const list = (p: string) => {
    const v = g(p);
    return Array.isArray(v) ? v.join(", ") : undefined;
  };

  const symbols = list("universe.symbols");
  const ladder = list("tenor_scan.dte_ladder");
  const vrp = g("tenor_scan.vrp_threshold_vol_points");
  const dMin = g("structure.short_leg_delta_min");
  const dMax = g("structure.short_leg_delta_max");
  const wMin = g("structure.strike_width_usd_min");
  const wMax = g("structure.strike_width_usd_max");
  const perTrade = g("risk.max_risk_per_trade_pct_of_equity");
  const maxPos = g("risk.max_concurrent_positions");
  const ddStop = g("risk.daily_drawdown_stop_pct");
  const profit = g("exit.profit_target_pct_of_max_credit");
  const lossMult = g("exit.loss_close_credit_multiple");

  const parts: string[] = [];
  parts.push(
    `Beleth sells defined-risk vertical credit spreads${
      symbols ? ` on ${symbols}` : ""
    }.`,
  );
  if (ladder || vrp !== undefined) {
    parts.push(
      `Each cycle it scans${ladder ? ` ${ladder}` : ""} days to expiry and opens the single tenor whose volatility risk premium clears${
        vrp !== undefined ? ` ${vrp} vol points` : " the threshold"
      } — or it stays flat and says why.`,
    );
  }
  if (dMin !== undefined && dMax !== undefined) {
    parts.push(
      `The short strike sits at ${dMin}–${dMax} delta${
        wMin !== undefined && wMax !== undefined
          ? `, the spread $${wMin}–$${wMax} wide`
          : ""
      }.`,
    );
  }
  if (perTrade !== undefined) {
    parts.push(
      `Risk is capped at ${perTrade}% of equity per trade${
        maxPos !== undefined ? `, ${maxPos} open at once` : ""
      }${ddStop !== undefined ? `, with a hard ${ddStop}% daily drawdown stop` : ""}.`,
    );
  }
  if (profit !== undefined && lossMult !== undefined) {
    parts.push(
      `Winners are taken at ${profit}% of max credit; losers are cut at ${lossMult}× the credit or the moment the short leg goes in the money.`,
    );
  }
  return parts.join(" ");
}
