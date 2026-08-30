<p align="center">
  <img src="assets/beleth-avatar.png" alt="Beleth" width="120">
</p>

# Beleth Agent

Autonomous AI options-trading agent built for the [Alpaca AI Trading Agents Hackathon](https://lablab.ai)
(lablab.ai, Aug 28 – Sep 4, 2026). Trades exclusively on a dedicated Alpaca **paper trading**
account and includes options trading, themed around volatility, hedging, and portfolio overlays.

Character: **profitable, conservative, cautious.** Beleth is not built to maximize return at
any cost — it's built to show that a disciplined, transparent, risk-bounded system can still
be profitable. Every trade decision (and every risk-check rejection) is logged and surfaced,
not just the wins.

> **Status:** milestone 9 started — the webapp scaffold is in ([webapp/](webapp/), Next.js +
> Tailwind v4): the public homepage reads the live decision log from Supabase and deploys to
> Vercel. The agent itself is live: a market-hours-aware Docker loop with mechanical exit
> management (R5), the gated order path, and full decision persistence to Supabase. See
> [TODO.md](TODO.md) for what's next and the project notes for hard development
> constraints.
>
> Milestone 1 verified 2026-08-27: paper account active with options trading level 3 (multi-leg
> spreads enabled); SPY option chain fetch, Greeks/IV, and the delta filter confirmed against
> live data.
>
> Milestone 2 (2026-08-27): the agent now measures its edge before betting on it. It pulls the
> VIX regime from FRED, realized volatility from SPY bars, the IV term structure and a
> per-tenor volatility risk premium from the SPY chain, applies a macro-event gate, and
> assembles a single **evidence package** ([`docs/strategy.md`](docs/strategy.md)) for the
> decision layer. Run `uv run python scripts/check_market_data.py SPY` to print a live one.
> On 2026-08-27 no tenor on the 7/14/21/30/45-day ladder cleared the 1.5-vol-point VRP
> threshold, so the agent's verdict was **do not trade** — staying still is a designed
> behaviour, not a failure.
>
> Milestone 3 (2026-08-27): the explicit pre-trade risk check ([`app/risk_check.py`](app/risk_check.py))
> that every future order must pass. It produces a pass/fail verdict per rule with a plain-language
> reason — R4 (defined risk: max loss shown before the order, always), R6 (per-trade risk % and
> max concurrent positions, read from the live account), R7 (3% daily-drawdown stop rejects any
> new position). Run `uv run python scripts/check_risk.py SPY` to see verdicts against the real
> paper account. Provider note: Regolo was dropped 2026-08-28 (its trial API returned
> `402 trial_expired` on a fresh account) in favour of OpenRouter free models — a config-only
> change behind the same OpenAI-compatible client.
>
> Milestone 4 (2026-08-28): every cycle is persisted to **Supabase Postgres** — the single
> source of truth the webapp will read, and the verifiable decision log for judges.
> [`scripts/check_market_data.py`](scripts/check_market_data.py) now runs a full cycle
> (evidence package → risk gate → decision) and writes the append-only decision row (with the
> full evidence package and a strategy-config snapshot), one risk_checks row per
> (candidate, rule) — rejections are first-class rows — plus the open-positions mirror and the
> agent-status heartbeat. Schema in [`db/migrations/`](db/migrations/); data dictionary and the
> dashboard's queries in [`db/README.md`](db/README.md).
>
> Milestone 5 (2026-08-28): the **LLM decision layer** ([`app/decision.py`](app/decision.py))
> is wired into the cycle. When the market is open and at least one candidate has passed the
> pre-trade risk gate, the configured OpenRouter free model receives the evidence package plus
> the numbered approved candidates and records exactly one choice through a structured tool
> call — it can only pick from that list, cannot invent structures or sizes, and its failure
> degrades to the deterministic no-trade, never to a trade. The full
> [`docs/strategy.md`](docs/strategy.md) reasoning is injected into its system prompt; its
> reasoning and token usage are persisted with every decision. The R2 regime gate
> (backwardation) is now enforced in the candidate pipeline, not just reported.
>
> Milestone 6 (2026-08-28): the **order path** ([`app/orders.py`](app/orders.py)) is live.
> A `trade` decision becomes exactly one multi-leg `mleg` limit order on the Alpaca paper
> account — the chosen candidate's own two legs inside a single order (short sell-to-open,
> long buy-to-open, never split, never naked), sized by `risk.max_risk_per_trade_pct_of_equity`
> and priced at the measured credit minus a configured slippage. The order is submitted only
> after the decision row is persisted; sizing or pricing that cannot respect the cap fails
> closed with the reason in the persisted summary, and a submission rejection is persisted as
> a first-class `submission_failed` trades row. The API contract (mleg semantics, negative
> limit = net credit, day-only TIF) was verified live: one qty-1 probe order accepted by the
> paper account, left unfilled by design, canceled cleanly.

### Data quality disclosure

Beleth runs on Alpaca's **Basic** data plan: the options feed is *indicative*, not full OPRA,
and historical data excludes the most recent 15 minutes. The implied volatility it reasons
over is therefore less precise than a professional's. The evaluation window is ~5 market days,
over which P&L is dominated by luck, not skill. Any P&L shown should be read with both facts
in mind — see [`docs/strategy.md`](docs/strategy.md) notes C2 and C5.

## Hard constraints

These are non-negotiable for the entire life of the project — see the project notes for
the full list:

- **Paper trading only.** No live-trading code path, ever.
- Every order passes an explicit **risk-check** before reaching Alpaca; rejections are logged
  and shown in the dashboard exactly like executed trades.
- **Defined-risk structures only** (vertical spreads and similar) — never naked / unlimited-loss
  positions.
- Every agent decision (input, reasoning, outcome, risk-check result) is persisted as a
  verifiable artifact.
- The LLM layer is provider-agnostic (OpenAI-compatible endpoint) — switching models is a
  config change, never
  a code change.

## Architecture

Two independent processes communicating only through Supabase — not a monolith. This keeps the
public showcase/dashboard reachable (last known state) even if the trading agent's host machine
is off; only new decisions pause.

- **Agent (Python, runs on a private machine):** Alpaca paper trading via `alpaca-py`, options
  strategy logic, LLM decisions via the OpenAI SDK → OpenRouter (a free tool-calling model,
  swappable via config). Writes every decision/risk-check/trade directly to Supabase Postgres.
  No inbound
  network exposure — outbound-only.
- **Webapp ([webapp/](webapp/), Next.js App Router on Vercel):** public homepage + authenticated
  dashboard/backoffice in one deploy, reading from the same Supabase database. Four access
  states via Supabase Auth + RLS: anonymous (public homepage only), public user (self-signup,
  curated dashboard), demo admin (full backoffice, read-only — a shared account for the
  judges), master admin (full operational control, operator only). Anonymous reads are opened
  by permissive SELECT policies (`db/migrations/0003_anon_read_policies.sql`); writes stay
  service-role only. Signed-in users also get **"Chat with Beleth"** — an in-character,
  **read-only** conversation (tools query Supabase + Alpaca, nothing acts) powered by AI/ML
  API on a free model; transcripts in `chat_sessions` / `chat_messages` with owner-scoped RLS.
- **Supabase:** shared Postgres — single source of truth for both sides — plus Auth for the
  webapp's access states.

Strategy: short vertical credit spreads on a **measured** volatility risk premium, always a
single defined-risk multi-leg order. The agent has no fixed expiry — it scans a ladder of
tenors (default 7/14/21/30/45 days), measures the volatility risk premium on each, and trades
only the tenor whose premium clears a threshold; if none does, it does not trade and says why.
Regime and event gates (VIX percentile from FRED, IV term structure from the SPY chain, a
macro-event calendar) sit in front of every entry. Full reasoning with sources in
[`docs/strategy.md`](docs/strategy.md); parameters in `config/strategy.yaml` (starting values,
not backtested by us — see the spec §5 for the honest read on expected performance: most trades
win, individual losses are structurally larger, and that's normal for this strategy, not a
bug).

## Repository layout

```
.
├── the project notes              # constraints and context for local tooling sessions
├── README.md              # this file
├── TODO.md                # task tracking
├── .env.example           # required environment variables (copy to .env, never commit .env)
├── pyproject.toml / uv.lock  # Python project, managed with uv
├── app/                   # agent package
│   ├── config.py          # settings + config/strategy.yaml loader
│   ├── alpaca_client.py   # paper-only Alpaca client wiring (trading + stock/option data)
│   ├── occ.py             # OCC option-symbol parsing (expiry/strike/right)
│   ├── vrp.py             # per-tenor volatility risk premium scan
│   ├── evidence.py        # assembles the evidence package for the decision layer
│   ├── market/            # VIX (FRED), realized vol, IV term structure, macro calendar
│   ├── options/           # chain fetch, delta filter, IV rank, spread-candidate builder
│   └── llm/                # OpenAI SDK → OpenRouter client
├── config/
│   ├── strategy.yaml      # strategy parameters (not hardcoded — see the project notes)
│   └── macro_events.yaml  # known macro events for the hackathon window (R3 gate)
├── docs/
│   └── strategy.md        # strategy reasoning by reliability tier, with sources
├── scripts/
│   ├── fetch_docs.py                  # re-downloads the local reference cache/ (gitignored local doc cache)
│   ├── smoke_test_tool_calling.py     # OpenRouter free-model tool-calling verification
│   ├── check_alpaca_connection.py     # paper account/positions read
│   ├── check_options_data.py          # SPY chain + delta filter
│   ├── check_market_data.py           # full evidence package (VIX + RV + term structure + VRP + candidates)
│   ├── run_agent.py                   # resident runner loop (one cycle per symbol per interval)
│   └── deploy_guard.py                # refuses a container rebuild while the market is open
├── tests/                 # unit tests (fast, no network) + integration tests (`pytest -m integration`)
├── assets/
│   └── beleth-avatar.png  # mascot art used in this README
└── local reference material at                # local-only: vendored docs, planning material (gitignored)
    ├── docs/               # Alpaca reference docs + vendored repos — see docs/INDEX.md
    └── preprod/            # full the project spec and pre-dev design material
```

## Getting started

1. Clone the repo.
2. `cp .env.example .env` and fill in your Alpaca paper trading API keys and your OpenRouter key.
3. Repopulate the local Alpaca documentation cache (gitignored, not shipped in the repo):
   ```
   python3 scripts/fetch_docs.py
   ```
4. Install dependencies and run the read-only checks (requires [`uv`](https://docs.astral.sh/uv/)):
   ```
   uv sync
   uv run python scripts/check_alpaca_connection.py
   uv run python scripts/check_options_data.py SPY
   uv run python scripts/check_market_data.py SPY   # full cycle: evidence → risk gate → decision → (order) → persists to Supabase
   uv run python scripts/check_order_path.py --dry-run   # build the mleg order a trade decision would send; submits nothing
   uv run python scripts/check_supabase_connection.py --smoke   # persistence round trip (needs SUPABASE_* in .env)
   uv run pytest                    # fast unit tests, no network
   uv run pytest -m integration     # hits the real paper account + market data + FRED + Supabase
   ```
5. The authenticated webapp dashboard (public-user / demo-admin / master-admin views) is not
   built yet — the public homepage is live in [webapp/](webapp/). See [TODO.md](TODO.md).

## Running the resident agent (the trading host)

The agent runs as a single Docker service defined in [`compose.yaml`](compose.yaml) —
outbound-only, no exposed ports, `restart: unless-stopped` as the process supervision.

```
python scripts/deploy_guard.py && docker compose up -d --build   # rebuild only when the market is closed
docker compose logs -f beleth-agent                              # live narrative (also mirrored to the logs volume)
docker compose stop beleth-agent                                 # graceful SIGTERM stop
```

Operational notes:

- **Never rebuild during market hours.** `docker compose up --build` recreates the
  container, killing the in-flight cycle and the resting-order guard's live view.
  `scripts/deploy_guard.py` exits non-zero while the market is open (`--force` overrides
  for an emergency fix).
- **Logs.** Docker's own `json-file` logs are capped (`max-size: 10m`, `max-file: 5`)
  and are still discarded on every recreate. The runner also mirrors its stdout/stderr
  to a rotating file in the `beleth-logs` named volume (`/app/logs/runner.log`,
  `5 MB × 5`), which survives a rebuild. Cadence and log settings live in
  `config/strategy.yaml` under `runner:`.
- **Memory.** The service has a hard 512 MiB limit, so a leak surfaces as a clean OOM
  kill (`docker inspect` → `OOMKilled=true`, `RestartCount` climbs) rather than starving
  the host. Day-1 steady state was ~80 MiB.
- **Kill switch.** Set `agent_status.paused = true` in Supabase to suspend cycles
  without stopping the container; the loop polls it every 30 s and the agent never
  writes that column itself.
- The durable record (decisions, risk-check outcomes, trades, heartbeat) is in Supabase
  and survives every container recreation — the mirrored log is a debugging convenience,
  not the source of truth.

## License

TBD.
