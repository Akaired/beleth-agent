/**
 * The operating rules R1–R11 the agent actually runs on, mirrored from
 * docs/strategy.md so the reasoning — and its reliability tier — is visible in
 * the backoffice, not just in the repo. Kept as hand-authored structured data
 * (one source to keep in sync, but no brittle Markdown parsing at build time).
 *
 * Tiers:
 *   A — supported by academic or institutional research
 *   B — industry convention, not peer-reviewed; parameters to tune
 *   C — our own deliberate choice, with its cost stated
 */

export type Tier = "A" | "B" | "C";

export type OperatingRule = {
  id: string;
  title: string;
  tier: Tier;
  body: string;
  sources: string[];
};

export const TIER_LABEL: Record<Tier, string> = {
  A: "Research",
  B: "Convention",
  C: "Our choice",
};

export const TIER_BLURB: Record<Tier, string> = {
  A: "Supported by academic or institutional research.",
  B: "Industry convention, not peer-reviewed — parameters to tune. Many come from tastytrade-adjacent sources that earn on volume.",
  C: "Our own deliberate choice, with its cost stated openly.",
};

export const OPERATING_RULES: OperatingRule[] = [
  {
    id: "R1",
    title: "Open only into a paid-for premium",
    tier: "A",
    body: "Do not open unless the volatility risk premium measured on the candidate tenor exceeds the threshold (default 1.5 vol points). The premium is real but tenor-dependent — widest at 60–90 days, small and unstable under a week, where jump premium dominates.",
    sources: [
      "A1 — VRP exists: SPX 30-day, 5-year avg IV 16.2% vs RV 13.4%, positive in 73% of months (optionsanalysissuite.com)",
      "A3 — the VRP varies by tenor; near-zero under 7 days (optionsanalysissuite.com)",
    ],
  },
  {
    id: "R2",
    title: "No new shorts into backwardation",
    tier: "A",
    body: "If the term structure is inverted — short-tenor ATM IV above long-tenor ATM IV — open no new short-premium position. Backwardation is a statistically significant stress signal; contango is not, so it is never an entry signal.",
    sources: [
      "A5 — Macrosynergy, VIX term structure as a trading signal, 2010–2017",
    ],
  },
  {
    id: "R3",
    title: "Macro-event blackout",
    tier: "C",
    body: "No new position whose expiry falls on or after a known macro event within N days (default 2). The event list is hand-maintained for the hackathon window — no calendar-provider integration.",
    sources: ["C — our choice; scoped for the hackathon, stated as such"],
  },
  {
    id: "R4",
    title: "Defined risk, always, and shown first",
    tier: "C",
    body: "Every position is one multi-leg vertical spread with a computed maximum loss, logged and displayed before the order is sent. Never naked legs, never two orders for one spread, never unbounded loss.",
    sources: [
      "A2 — the VRP is compensation for crash risk; put sellers have taken losses as deep as −800% (Quantpedia)",
      "A7 — Feb 2018 Volmageddon: levered short-vol products lost >90% in a day (CFA Institute)",
    ],
  },
  {
    id: "R5",
    title: "Mechanical exits",
    tier: "B",
    body: "Exits are never LLM-gated. Take profit at 50% of the max credit; cut the loss at 2× the credit received, or the instant the short leg goes in-the-money. Every cycle the open legs are paired back into spreads and each is measured against these targets.",
    sources: [
      "B1 — take profit at 50% of the maximum credit",
      "B2 — manage the position at 21 days to expiration",
    ],
  },
  {
    id: "R6",
    title: "Per-trade sizing & position count",
    tier: "B",
    body: "Risk 1–2% of equity per trade (the upper bound is the hard cap; quantity is sized down to fit), at most 3–5 open positions. R6 is now only the per-trade cap and the count — the account-state block is R10, the aggregate dollar cap is R11.",
    sources: [
      "B3 — short-leg delta 0.15–0.25",
      "B4 — indicative 70–75% win rate at 25–30 delta, 45 DTE, held to expiration",
    ],
  },
  {
    id: "R7",
    title: "Daily drawdown stop",
    tier: "C",
    body: "Intraday drawdown beyond 3% from the prior close → stop opening new positions for the rest of the session. Open positions keep being managed by R5.",
    sources: ["C — our risk choice; a circuit breaker, not a hedge"],
  },
  {
    id: "R8",
    title: "Staying still is a valid output",
    tier: "C",
    body: "If no tenor clears the threshold, do not trade and state the reason in the dashboard. An agent that knows how to stay still is part of the project, not a fault.",
    sources: [
      "C4 — multi-tenor scan instead of a fixed expiry, our direct answer to A3",
    ],
  },
  {
    id: "R9",
    title: "VIX-regime size taper",
    tier: "C",
    body: "Per-trade size is scaled by a 0–1 multiplier read off the VIX's own 1-year percentile: full size at/above the 25th percentile, a straight line down to half size at/below the 3rd, and no new entry at all below the 3rd. A taper, not a blanket block — low VIX is a weak timing signal and our evaluation window is only ~5 days, so a hard block can mean zero trades for a week. Thresholds calibrated on VIX-close history 1990–2026 (252-day lookback): percentile < 25 on ~33% of days, usually a multi-week regime; percentile < 3 on ~8%, in mostly short episodes — the genuine extreme-complacency tail.",
    sources: [
      "A4 — use the VIX as a regime measure via its own 1-year percentile, not as a proxy for the traded contracts' IV (blog.harbourfronts.com)",
      "Level A — low VIX is a weak timing signal (Simon & Wiggins 2001; CBOE)",
      "Calibrated on 1990–2026 VIX-close base rates (252-day lookback, the production window)",
    ],
  },
  {
    id: "R10",
    title: "Entry blocked by account state",
    tier: "C",
    body: "A resting entry order, naked or unpaired option legs, an open spread whose entry credit cannot be computed, or an unreadable order book each reject every new entry with their own tagged rejection row. Split off R6 on day 1, when every 'R6' rejection turned out to be this and not a real sizing failure. Exits are never gated by R10.",
    sources: [
      "C — transparency requirement (hard constraint #3): a 'no' must be legible in the dashboard",
    ],
  },
  {
    id: "R11",
    title: "Aggregate risk cap",
    tier: "C",
    body: "Committed maximum loss across all open positions, plus a new candidate's max loss, must stay within 6% of equity (2× the daily stop), else the candidate is rejected with its own R11 row. A conservative floor — it projects one spread's max loss before quantity is sized down.",
    sources: [
      "C — architectural hygiene: R6 bounds each trade and the count, R11 bounds their sum; SPY/QQQ ~0.95 correlated, treated as one bet",
    ],
  },
];
