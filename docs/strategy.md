# Beleth Agent — Strategy

This file is the strategy's reasoning, organised by **how much we can trust each claim**. It
is injected into the agent's system prompt and cited in the dashboard when the agent explains
a decision. Every claim carries its source.

Three reliability tiers:

- **Level A** — supported by academic or institutional research.
- **Level B** — industry convention, *not* peer-reviewed. Treat as parameters to tune.
- **Level C** — our own deliberate choices, with their cost stated.

Then: **derived operating rules** the agent actually runs on, and the **evidence package**
schema those rules consume.

---

## Level A — supported by academic or institutional research

**A1. The volatility risk premium exists.** Implied volatility systematically exceeds the
realized volatility that follows. SPX 30-day, five-year average: IV 16.2%, RV 13.4%, VRP 2.8
volatility points, positive in 73% of months.
*Source: optionsanalysissuite.com — "Variance Risk Premium".*

**A2. It is not free money — it is compensation for crash risk.** This is a fat-tailed
strategy that loses heavily during crises; it is not a hedge. Put sellers have historically
taken losses as deep as −800%, and losing days are strongly autocorrelated (they arrive in
clusters).
*Source: Quantpedia — "Volatility Risk Premium Effect".*

**A3. The VRP varies by tenor.** Widest at 60–90 days, standard at 30, small and unstable at
1–7 days. In event-free windows the short-dated VRP can be zero or negative, because
short-dated IV is dominated by the jump premium tied to imminent events. Gamma risk also
rises sharply under 30 days.
*Source: optionsanalysissuite.com — "Variance Risk Premium".*

**A4. The VIX is not ATM implied volatility.** It is model-independent, includes
out-of-the-money strikes, embeds skew, and runs systematically above ATM IV. It does
correlate better with subsequent realized volatility (0.6397 vs 0.5925, April 2009 –
December 2018). VIX squared approximates the 30-day variance-swap rate. Use the VIX as a
**regime** measure (its own one-year percentile) and as a 30-day premium thermometer — never
as a proxy for the IV of the specific contracts we trade, for which we use those contracts'
own IV (which Alpaca provides).
*Source: blog.harbourfronts.com — "VIX vs ATM implied volatility".*

**A5. Term structure: backwardation is a statistically significant signal; contango is not.**
Do not build entry signals on contango — a market can stay complacent longer than it can stay
in panic.
*Source: Macrosynergy — "VIX term structure as a trading signal", 2010–2017.*

**A6. CBOE PutWrite benchmark.** 1986–2015: 10.1% annualized return vs 9.8% for the S&P 500,
Sharpe 0.67 vs 0.47. 2006–2015: volatility 11.5% vs 15.1%, maximum drawdown −33% vs −51%.
*Source: CBOE / Bondarenko; CXO Advisory.*

**A7. Documented failure mode.** February 2018 "Volmageddon": levered short-volatility
products lost more than 90% in a single day through a rebalancing feedback loop.
*Source: CFA Institute — "Volmageddon and the Failure of Short Volatility Products".*

---

## Level B — industry convention, NOT peer-reviewed

**Caveat, stated plainly:** many of these rules come from tastytrade and broker-adjacent
sources, which have a structural conflict of interest — they earn on trading volume. They are
plausible and widespread, not science. Treat them as parameters to calibrate.

- **B1.** Take profit at 50% of the maximum credit.
- **B2.** Manage the position at 21 days to expiration.
- **B3.** Short-leg delta 0.15–0.25.
- **B4.** Indicative win rate 70–75% with 25–30 delta at 45 DTE, held to expiration.
- **B5.** 45 DTE as the compromise between premium collected, capital efficiency, and risk.

---

## Level C — our own deliberate choices, with their cost

- **C1.** Paper trading only, for the entire duration. Hackathon requirement.
- **C2.** Alpaca Basic data plan: the options feed is *indicative*, not full OPRA, and
  historical data excludes the most recent 15 minutes. Consequence: the IV we reason over is
  less precise than a professional's. **Stated in the README** — a judge assessing the P&L is
  entitled to know the data quality it was produced on.
- **C3.** Narrow universe (SPY, possibly QQQ) to guarantee liquidity and therefore realistic
  fills even in simulation.
- **C4.** Multi-tenor scan instead of a fixed expiry — our direct answer to A3.
- **C5.** The evaluation window is roughly 5 market days. Over that horizon P&L is dominated
  by luck, not skill. Stated openly: we do not inflate the result or present fortune as
  merit.

---

## Derived operating rules

These are what the agent runs on. Parameters live in `config/strategy.yaml`, never in code.

- **R1.** Do not open unless the VRP measured on the candidate tenor exceeds the threshold
  (default 1.5 volatility points, configurable — `tenor_scan.vrp_threshold_vol_points`).
- **R2.** Regime gate: if the term structure is inverted (short ATM IV > long ATM IV), no new
  short-premium position (`regime.block_new_shorts_on_backwardation`).
- **R3.** Event gate: no new position whose expiry falls on/after a known macro event within
  N days (default 2 — `macro_calendar.block_within_days`). Event list in
  `config/macro_events.yaml`, hand-maintained for the hackathon.
- **R4.** Defined risk only. Maximum loss is computed, logged, and shown *before* the order is
  submitted.
- **R5.** Exit: 50% of the credit in profit; 2× the credit in loss, or the short leg going
  in-the-money. Exits are mechanical risk management, never LLM-gated: every cycle the open
  legs are paired back into spreads (same root/expiry/right; a short pairs with the
  nearest-strike protective long) and each spread is measured. Entry economics come from the
  legs' own filled prices, so exit management never depends on the trades log staying
  complete. A triggered close is one `mleg` order closing both legs inside it, priced to
  fill (mark + a wider-than-entry slippage concession — a protective close that rests
  unfilled is worse than paying for liquidity). Naked legs, unpaired protective legs, or a
  spread whose entry credit cannot be computed block every new entry until resolved.
- **R6.** Sizing: risk 1–2% per trade, at most 3–5 open positions.
- **R7.** Daily stop: intraday drawdown beyond 3% → stop opening new positions for the day.
- **R8.** If no tenor clears the threshold, **do not trade** and state the reason in the
  dashboard. An agent that knows how to stay still is part of the project, not a fault.

### How the pieces map to data sources

| Input | Source | Notes |
|---|---|---|
| VIX level, 1y percentile / rank | FRED series `VIXCLS` (CSV, no API key); CBOE history as fallback | Alpaca does not provide index data and has said it has no plans to (forum.alpaca.markets/t/quotes-for-indices/13743). No ETF proxy. |
| Term structure | SPY chain — ATM IV at the shortest ladder tenor vs the longest | We have no VIX futures. `short IV < long IV` → contango; `short IV > long IV` → backwardation. |
| Realized volatility (10/20/30d) | Alpaca SPY daily bars, close-to-close, annualized | Split/dividend adjusted. |
| Per-tenor IV, per-contract Greeks | Alpaca SPY option chain snapshots | Indicative feed (C2). |
| Macro calendar | `config/macro_events.yaml` | Hackathon window: no relevant events 28 Aug – 3 Sep (JOLTS 1 Sep is minor); Nonfarm Payrolls Fri 4 Sep 08:30 ET. |

---

## Evidence package

Computed by the code every cycle and passed to the model. Numbers, not prose: the model
already knows what theta is; it needs to know what it is worth today. Every persisted
decision must include the evidence package that produced it, so every choice is
reconstructible after the fact.

```json
{
  "as_of": "ISO timestamp", "market_open": true,
  "underlying": {
    "symbol": "SPY", "last": 0.0,
    "realized_vol": { "10d": 0.0, "20d": 0.0, "30d": 0.0 }
  },
  "vix": {
    "level": 0.0, "percentile_1y": 0.0, "rank_1y": 0.0,
    "term_structure": "contango | backwardation | flat",
    "short_atm_iv": 0.0, "long_atm_iv": 0.0
  },
  "vrp": {
    "vix_minus_rv20": 0.0,
    "per_tenor": [ { "dte": 0, "atm_iv": 0.0, "vrp_vs_rv20": 0.0, "passes_threshold": false } ]
  },
  "calendar": {
    "next_macro_event": { "name": "", "datetime_et": "", "days_away": 0 },
    "blocks_tenors": [ 0 ]
  },
  "candidates": [ {
    "symbol": "SPY", "expiry": "", "dte": 0, "strikes": [0, 0],
    "delta_short": 0.0, "credit": 0.0, "max_loss": 0.0, "breakeven": 0.0,
    "bid_ask_spread": 0.0
  } ],
  "open_positions_detail": [ {
    "symbol": "SPY", "right": "P", "expiry": "", "dte": 0, "strikes": [0, 0],
    "strike_width": 0.0, "qty": 0, "entry_credit": 0.0, "max_loss": 0.0,
    "short_symbol": "", "long_symbol": ""
  } ],
  "account": {
    "cash": 0.0, "buying_power": 0.0, "open_positions": 0, "day_pnl": 0.0,
    "risk_budget_remaining_today": 0.0
  }
}
```

Assembled by `app/evidence.py`; run `python scripts/check_market_data.py SPY` to print a real
one. `vrp.vix_minus_rv20` is the 30-day premium in volatility points (VIX level minus 20-day
realized vol); `vrp.per_tenor[].vrp_vs_rv20` is that tenor's own ATM IV minus 20-day realized
vol, also in volatility points, and is the quantity R1 gates on. `open_positions_detail` lists
the spreads reconstructed from the account's open legs — each entry is one R5-managed
position, empty when the account is flat.
