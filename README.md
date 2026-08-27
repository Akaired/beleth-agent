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

> **Status:** milestone 1 (agent-side read-only data plumbing) verified against the real paper
> account and real market data — no orders placed yet, no webapp yet. See [TODO.md](TODO.md) for
> what's next and the project notes for hard development constraints.
>
> Verified 2026-08-27: paper account active with options trading level 3 (multi-leg spreads
> enabled); SPY option chain fetch, Greeks/IV, and the delta filter all confirmed against live
> data (1934 contracts in the 1-7 day expiry window → 40 after the delta filter, ~654 tokens).
> Still pending: the Regolo tool-calling smoke test (written, deliberately not run yet to
> preserve the daily token quota).

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
├── pyproject.toml / uv.lock  # Python project, managed with uv
├── app/                   # agent package
│   ├── config.py          # settings + config/strategy.yaml loader
│   ├── alpaca_client.py   # paper-only Alpaca client wiring
│   ├── options/           # chain fetch, delta filter, IV rank
│   └── llm/                # LiteLLM → Regolo client
├── config/
│   └── strategy.yaml      # strategy parameters (not hardcoded — see the project notes)
├── scripts/
│   ├── fetch_docs.py                  # re-downloads the local reference cache/ (gitignored local doc cache)
│   ├── smoke_test_tool_calling.py     # Regolo tool-calling verification
│   ├── check_alpaca_connection.py     # paper account/positions read
│   └── check_options_data.py          # SPY chain + IV rank + delta filter
├── tests/                 # unit tests (fast, no network) + integration tests (`pytest -m integration`)
├── assets/
│   └── beleth-avatar.png  # mascot art used in this README
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
4. Install dependencies and run the read-only checks (requires [`uv`](https://docs.astral.sh/uv/)):
   ```
   uv sync
   uv run python scripts/check_alpaca_connection.py
   uv run python scripts/check_options_data.py SPY
   uv run pytest                    # fast unit tests, no network
   uv run pytest -m integration     # hits the real paper account + market data
   ```
5. Agent decision logic, persistence, and the webapp are not built yet — see
   [TODO.md](TODO.md).

## License

TBD.
