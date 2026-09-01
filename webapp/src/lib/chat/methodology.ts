/**
 * A build-time copy of `docs/strategy.md` (repo root), inlined as a string so
 * the webapp can hand it to the chat model on Vercel — Next cannot read files
 * outside its own directory at runtime.
 *
 * SOURCE OF TRUTH IS `docs/strategy.md`. Keep this in sync when that file
 * changes: copy its content into the template literal below. The agent injects
 * the real file into its decision prompt (app/decision.py); this constant is
 * the webapp's read-only mirror for "Chat with Beleth".
 */
export const METHODOLOGY_TEXT = String.raw`# Beleth Agent — Strategy

This file is the strategy's reasoning, organised by how much we can trust each claim. Every
claim carries its source.

Three reliability tiers:

- Level A — supported by academic or institutional research.
- Level B — industry convention, not peer-reviewed. Treat as parameters to tune.
- Level C — our own deliberate choices, with their cost stated.

## Level A — supported by academic or institutional research

A1. The volatility risk premium exists. Implied volatility systematically exceeds the
realized volatility that follows. SPX 30-day, five-year average: IV 16.2%, RV 13.4%, VRP 2.8
volatility points, positive in 73% of months. (Source: optionsanalysissuite.com — "Variance
Risk Premium".)

A2. It is not free money — it is compensation for crash risk. This is a fat-tailed strategy
that loses heavily during crises; it is not a hedge. Put sellers have historically taken
losses as deep as -800%, and losing days are strongly autocorrelated (they arrive in
clusters). (Source: Quantpedia — "Volatility Risk Premium Effect".)

A3. The VRP varies by tenor. Widest at 60-90 days, standard at 30, small and unstable at 1-7
days. In event-free windows the short-dated VRP can be zero or negative, because short-dated
IV is dominated by the jump premium tied to imminent events. Gamma risk also rises sharply
under 30 days. (Source: optionsanalysissuite.com — "Variance Risk Premium".)

A4. The VIX is not ATM implied volatility. It is model-independent, includes out-of-the-money
strikes, embeds skew, and runs systematically above ATM IV. Use the VIX as a regime measure
(its own one-year percentile) and as a 30-day premium thermometer — never as a proxy for the
IV of the specific contracts we trade. (Source: blog.harbourfronts.com — "VIX vs ATM implied
volatility".)

A5. Term structure: backwardation is a statistically significant signal; contango is not. Do
not build entry signals on contango — a market can stay complacent longer than it can stay in
panic. (Source: Macrosynergy — "VIX term structure as a trading signal", 2010-2017.)

A6. CBOE PutWrite benchmark. 1986-2015: 10.1% annualized return vs 9.8% for the S&P 500,
Sharpe 0.67 vs 0.47. 2006-2015: volatility 11.5% vs 15.1%, maximum drawdown -33% vs -51%.
(Source: CBOE / Bondarenko; CXO Advisory.)

A7. Documented failure mode. February 2018 "Volmageddon": levered short-volatility products
lost more than 90% in a single day through a rebalancing feedback loop. (Source: CFA
Institute — "Volmageddon and the Failure of Short Volatility Products".)

## Level B — industry convention, NOT peer-reviewed

Caveat, stated plainly: many of these rules come from tastytrade and broker-adjacent sources,
which have a structural conflict of interest — they earn on trading volume. Plausible and
widespread, not science. Treat them as parameters to calibrate.

- B1. Take profit at 50% of the maximum credit.
- B2. Manage the position at 21 days to expiration.
- B3. Short-leg delta 0.15-0.25.
- B4. Indicative win rate 70-75% with 25-30 delta at 45 DTE, held to expiration.
- B5. 45 DTE as the compromise between premium collected, capital efficiency, and risk.

## Level C — our own deliberate choices, with their cost

- C1. Paper trading only, for the entire duration. Hackathon requirement.
- C2. Alpaca Basic data plan: the options feed is indicative, not full OPRA, and historical
  data excludes the most recent 15 minutes. The IV we reason over is less precise than a
  professional's. Stated in the README.
- C3. Narrow universe (SPY, QQQ) to guarantee liquidity and therefore realistic fills even in
  simulation.
- C4. Multi-tenor scan instead of a fixed expiry — our direct answer to A3.
- C5. The evaluation window is roughly 5 market days. Over that horizon P&L is dominated by
  luck, not skill. We do not inflate the result or present fortune as merit.

## Derived operating rules

These are what the agent runs on. Parameters live in config/strategy.yaml, never in code.

- R1. Do not open unless the VRP measured on the candidate tenor exceeds the threshold
  (default 1.5 volatility points — tenor_scan.vrp_threshold_vol_points).
- R2. Regime gate: if the term structure is inverted (short ATM IV > long ATM IV), no new
  short-premium position (regime.block_new_shorts_on_backwardation).
- R3. Event gate: no new position whose expiry falls on/after a known macro event within N
  days (default 2 — macro_calendar.block_within_days). Event list in config/macro_events.yaml,
  hand-maintained for the hackathon.
- R4. Defined risk only. Maximum loss is computed, logged, and shown before the order is
  submitted.
- R5. Exit: 50% of the credit in profit; 2x the credit in loss, or the short leg going
  in-the-money. Exits are mechanical risk management, never LLM-gated: every cycle the open
  legs are paired back into spreads and each spread is measured. A triggered close is one
  mleg order closing both legs, priced to fill.
- R6. Sizing: risk 1-2% per trade, at most 3-5 open positions. R6 is now only the per-trade
  cap and the position count — the account-state entry block is R10 and the aggregate dollar
  cap is R11.
- R7. Daily stop: intraday drawdown beyond 3% -> stop opening new positions for the day.
- R8. If no tenor clears the threshold, do not trade and state the reason. An agent that
  knows how to stay still is part of the project, not a fault.
- R9. VIX-regime size taper. The per-trade risk budget is scaled by a 0.0-1.0 multiplier read
  off the VIX's own 1-year percentile: full size at/above entry.vix_regime.taper_upper_pct, a
  single straight line down to taper_floor_frac at/below taper_lower_pct, and 0.0 — no new
  entry — strictly below block_below_pct. Only the hard block produces a visible R9 rejection
  row. Calibrated values: 25 / 3 / 0.5 / 3. VIX unavailable -> multiplier 1.0.
- R10. Entry blocked by account state (block_entries): a resting entry order, unpaired/naked
  option legs, an open spread whose entry credit cannot be computed, or an unreadable order
  book each reject every new entry with their own rejection row. Exits are never gated by R10.
- R11. Aggregate risk cap (apply_aggregate_cap). Committed risk across open positions plus a
  new candidate's max loss must stay within risk.max_aggregate_risk_pct_of_equity of equity,
  else the candidate is rejected with its own R11 row.

## How the pieces map to data sources

- VIX level, 1y percentile / rank: FRED series VIXCLS (CSV, no API key); CBOE history as
  fallback. Alpaca does not provide index data. No ETF proxy.
- Term structure: SPY chain — ATM IV at the shortest ladder tenor vs the longest. short IV <
  long IV -> contango; short IV > long IV -> backwardation.
- Realized volatility (10/20/30d): Alpaca SPY daily bars, close-to-close, annualized.
- Per-tenor IV, per-contract Greeks: Alpaca SPY option chain snapshots (indicative feed, C2).
- Macro calendar: config/macro_events.yaml, hand-maintained for the hackathon window.

## Evidence package

Computed by the code every cycle and passed to the model — numbers, not prose. Every
persisted decision includes the evidence package that produced it, so every choice is
reconstructible after the fact. Key fields: underlying.last and realized_vol; vix.level,
vix.percentile_1y, vix.term_structure; vrp.vix_minus_rv20 (the 30-day premium in volatility
points) and vrp.per_tenor[] (each tenor's own ATM IV minus 20-day realized vol, the quantity
R1 gates on); calendar.next_macro_event and calendar.blocks_tenors; candidates[] with credit,
max_loss and breakeven; account cash / buying_power / day_pnl.`;
