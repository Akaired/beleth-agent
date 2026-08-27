# Beleth Agent

Autonomous AI options-trading agent built for the [Alpaca AI Trading Agents Hackathon](https://lablab.ai)
(lablab.ai, Aug 28 – Sep 4, 2026). Trades exclusively on a dedicated Alpaca **paper trading**
account and includes options trading, themed around volatility, hedging, and portfolio overlays.

Character: **profitable, conservative, cautious.** Beleth is not built to maximize return at
any cost — it's built to show that a disciplined, transparent, risk-bounded system can still
be profitable. Every trade decision (and every risk-check rejection) is logged and surfaced,
not just the wins.

> **Status:** in development, milestone 1 (agent-side read-only data plumbing — no orders yet,
> no webapp yet). See [TODO.md](TODO.md) for what's next and the project notes for hard
> development constraints.

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
- The LLM layer is provider-agnostic (via LiteLLM) — switching models is a config change, never
  a code change.

## Architecture

Two independent processes communicating only through Supabase — not a monolith. This keeps the
public showcase/dashboard reachable (last known state) even if the trading agent's host machine
is off; only new decisions pause.

- **Agent (Python, runs on a private machine):** Alpaca paper trading via `alpaca-py`, options
  strategy logic, LLM decisions via LiteLLM → Regolo.ai (`Llama-3.3-70B-Instruct`, swappable via
  config). Writes every decision/risk-check/trade directly to Supabase Postgres. No inbound
  network exposure — outbound-only.
- **Webapp (Next.js App Router on Vercel):** public showcase + authenticated dashboard/backoffice
  in one deploy, reading from the same Supabase database. Three access levels via Supabase Auth
  + RLS: public (showcase + limited live view), demo admin (full read-only detail), admin (full
  control, operator only).
- **Supabase:** shared Postgres — single source of truth for both sides — plus Auth for the
  webapp's access levels.

Strategy: short vertical credit spreads on elevated implied volatility, short-dated, always a
single defined-risk multi-leg order. Full parameters in `config/strategy.yaml` (industry-standard
starting values, not backtested by us — see the spec §5 for the honest read on expected performance:
most trades win, individual losses are structurally larger, and that's normal for this strategy,
not a bug).

## Repository layout

```
.
├── the project notes              # constraints and context for local tooling sessions
├── README.md              # this file
├── TODO.md                # task tracking
├── .env.example           # required environment variables (copy to .env, never commit .env)
├── scripts/
│   └── fetch_docs.py      # re-downloads the local reference cache/ (gitignored local doc cache)
└── local reference material at                # local-only: vendored docs, planning material (gitignored)
    ├── docs/               # Alpaca reference docs + vendored repos — see docs/INDEX.md
    └── preprod/            # full the project spec and pre-dev design material
```

## Getting started

1. Clone the repo.
2. `cp .env.example .env` and fill in your Alpaca paper trading API keys and your Regolo.ai key.
3. Repopulate the local Alpaca documentation cache (gitignored, not shipped in the repo):
   ```
   python3 scripts/fetch_docs.py
   ```
4. Application setup (dependency install, running the backend/frontend) will be documented here
   once the first working code lands.

## License

TBD.
