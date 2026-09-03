# Beleth — One-Pager (Alpaca AI Trading Agents Hackathon)

**Team:** Davide Maiorana | **Repo:** github.com/Akaired/beleth-agent | **Live:** beleth.davidemaiorana.dev

Beleth is an autonomous agent that sells option premium through defined-risk short vertical credit spreads, with a public dashboard that shows in real time not just what it does, but what the risk management system *rejected* and why. The goal isn't to maximize trades executed — it's to demonstrate discipline: profitable, cautious, verifiable.

## AI Logic

An LLM (routed through LiteLLM on Regolo.ai to stay provider-agnostic) evaluates an evidence package at every cycle, built from real-time Alpaca data: volatility risk premium (VRP), implied volatility term structure, 1-year VIX percentile and rank, and the macro event calendar. The model decides whether there's sufficient edge to open a short vertical credit spread on elevated implied volatility, and produces a text rationale that gets published alongside the decision — for both executed trades and no-trades. The strategy is always defined-risk: a single multi-leg order, never naked legs.

## Risk Gates

Eleven rules (R1–R11) live in production, calibrated on real historical data and on behavior observed during day 1 of live trading:

- **R1** minimum VRP threshold to open a position
- **R2** blocks on inverted IV term structure
- **R3** blocks on macro events within the window
- **R4** defined-risk structures only, never naked legs
- **R5** automatic exit at 50% profit or 2x loss
- **R6** sizing at 1–2% of equity per trade + max open positions cap
- **R7** daily stop at 3% drawdown
- **R8** no tradeable expiration above threshold → the system stands down
- **R9** linear size taper based on 1-year VIX percentile (full size above p25, tapering to half size at p3, hard block below p3 — calibrated on CBOE VIX history 1990–2026)
- **R10** anti-stacking: blocks new entries if a resting entry order already exists on the same symbol
- **R11** aggregate risk cap on committed exposure (open positions + resting orders), 6% of equity across both symbols

Supporting this, a **dynamic slippage engine** estimates the real marketable price off the bid/ask spread instead of using a fixed slippage assumption: on day-1 candidates, the old fixed parameter would have been systematically underestimated (spread-to-credit ratio up to 7.3x).

Every rejection is tagged with the specific rule that triggered it and is shown publicly on the dashboard, not just logged internally.

## Alpaca Infrastructure

The agent runs in a dedicated Docker container, in **Alpaca paper trading**, with a `deploy_guard` that reads the Alpaca market clock and blocks redeploys while the market is open (explicit override required to bypass). Every cycle pulls market and options data from Alpaca, builds the evidence package (VRP, term structure, VIX percentile), submits the decision to the LLM, applies the risk gates, and — if approved — sends the multi-leg order via the Alpaca Trading API. State and logs persist to Supabase Postgres as the single source of truth; a Next.js webapp on Vercel reads from it to power the public real-time dashboard (cycles run, trades sent, trades rejected with rationale, current risk status).

## Why It Wins

Most hackathon bots show P&L. Beleth shows the *risk reasoning*: every no-trade is a documented decision, not an absence of activity. That's what makes an autonomous trading agent credible beyond the demo.
