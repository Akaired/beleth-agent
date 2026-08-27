# Beleth Agent

Autonomous AI options-trading agent built for the [Alpaca AI Trading Agents Hackathon](https://lablab.ai)
(lablab.ai, Aug 28 – Sep 4, 2026). Trades exclusively on a dedicated Alpaca **paper trading**
account and includes options trading, themed around volatility, hedging, and portfolio overlays.

Character: **profitable, conservative, cautious.** Beleth is not built to maximize return at
any cost — it's built to show that a disciplined, transparent, risk-bounded system can still
be profitable. Every trade decision (and every risk-check rejection) is logged and surfaced,
not just the wins.

> **Status:** pre-development. No agent code has been written yet — this repo currently holds
> project setup, vendored Alpaca documentation, and planning docs. See [TODO.md](TODO.md) for
> what's next and the project notes for hard development constraints.

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

## Planned stack

- **Backend:** Python 3.11+, FastAPI (REST + WebSocket for live agent state)
- **Alpaca integration:** official MCP server / CLI / `alpaca-py` SDK — see `the local reference cache/`
- **LLM layer:** LiteLLM abstraction, provider selected via config
- **Persistence:** SQLite or structured JSON (decisions, risk-checks, trades)
- **Frontend:** vanilla HTML/CSS/JS + Chart.js, no heavy framework
- **Deploy:** static frontend on a subdomain, backend exposed via Cloudflare Tunnel

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
2. `cp .env.example .env` and fill in your Alpaca paper trading API keys (and an LLM provider
   key once one is chosen — see open decisions below).
3. Repopulate the local Alpaca documentation cache (gitignored, not shipped in the repo):
   ```
   python3 scripts/fetch_docs.py
   ```
4. Application setup (dependency install, running the backend/frontend) will be documented here
   once the first working code lands.

## Open decisions

Tracked in the the project spec (`local design assetsbeleth-agent-prd.md`, §10) and not yet finalized:

1. Exact MVP trading strategy (proposed: systematic hedging overlay on a small liquid basket).
2. Default LLM provider for initial testing (the layer stays swappable regardless).
3. Whether/how much to extend into multi-asset portfolio overlays beyond the initial basket.
4. Exact subdomains for frontend/backend deployment.

## License

TBD.
