# Beleth webapp

The public showcase for the Beleth agent: a Next.js (App Router) app that reads
the decision log the agent persists to Supabase. **Reads only** — the agent owns
every write.

## Layout

- `src/app/` — public homepage (`/`), auth (`/login`), authenticated dashboard (`/dashboard/*`)
- `src/components/` — hand-written components matching the approved design mockup
- `src/lib/supabase.ts` — minimal typed PostgREST reader for the anon homepage
- `src/lib/queries.ts` — typed homepage reads + evidence-package mapping
- `src/lib/supabase/{server,client}.ts` — `@supabase/ssr` clients for the dashboard
- `src/lib/auth.ts` — session + role data-access layer (server only); `src/lib/roles.ts` — the client-safe role helper
- `src/lib/dashboard-queries.ts` — authenticated reads (overview, decision history/detail, strategy snapshot, control panel)
- `src/app/dashboard/controls/` — master-admin kill switch: `page.tsx`, `actions.ts` (`setAgentPausedAction`); `src/components/dashboard/kill-switch.tsx` is the client toggle
- `src/app/dashboard/chat/`, `src/app/dashboard/chats/`, `src/app/api/chat/` — "Chat with Beleth" (see below); engine in `src/lib/chat/`
- `src/proxy.ts` — Next 16 proxy (renamed middleware): refreshes the auth session, gates `/dashboard/*`
- `public/beleth.png`, `public/beleth-animated.svg` — the mascot

## Authentication & access states

Supabase Auth, **email + password** for now (magic link + Resend is a later
pass). Every signup gets a `public.profiles` row (created by a DB trigger) with
a `role`:

| Role | How it renders | How it's granted |
|---|---|---|
| `public_user` | curated dashboard: overview, equity curve, latest + recent decisions | default on signup |
| `demo_admin` | the above **plus** the read-only backoffice: full decision history, per-decision risk-check detail, raw LLM reasoning, strategy-config snapshot | manual `update public.profiles set role='demo_admin' where email=…` (service role / Management API) |
| `master_admin` | the above **plus** `/dashboard/controls` — the agent kill switch (pause / resume). Config editing and Alpaca account detail still to come | manual, same way |

Role changes are out of band: no RLS policy lets a user change their own role,
and the webapp never can. `db/migrations/0004_auth_roles.sql` adds the table,
the signup trigger, and the `public.beleth_role()` helper.

### The kill switch (`/dashboard/controls`)

The webapp's only write path. `db/migrations/0005_master_admin_kill_switch.sql`
adds `public.beleth_set_agent_paused(boolean)` — a `SECURITY DEFINER` function
that checks `beleth_role() = 'master_admin'`, flips **only** `agent_status.paused`,
and appends the change to `public.agent_control_events` (an audit log readable
by `demo_admin` and up). No UPDATE policy is added to `agent_status`; the
function is the only non-service-role writer. The resident runner reads
`paused` at the top of every cycle and obeys it fail-closed — a paused agent
writes a heartbeat and produces no decisions; nothing is cancelled. The
`setAgentPausedAction` server action re-checks the role before calling the RPC.

### Project auth config (set via the Management API / PAT)

- `mailer_autoconfirm = true` — **temporary.** Lets email+password signup work
  without SMTP. Revisit when Resend + magic link land: set it back to `false`
  and wire a custom SMTP sender.
- `site_url` = the Vercel production URL; `uri_allow_list` covers localhost,
  Vercel previews, and the custom domain.

### Chat with Beleth (`/dashboard/chat`, any signed-in user)

A conversational surface in the dashboard sidebar (its own section, between
*Live* and *Records*): **New chat**, **All chats**, then the three most recent
conversations. Beleth answers in character, in English, and **can only read** —
the tool layer (`src/lib/chat/tools.ts`) exposes nothing that writes, places a
trade, edits config, or pauses the agent.

- **Provider:** AI/ML API (`aimlapi.com`), an OpenAI-compatible endpoint,
  reached with a plain `fetch` (no SDK) in `src/lib/chat/aiml.ts`. This is the
  webapp's own LLM layer — **separate from the agent, which keeps OpenRouter**
  (the project notes resolved decision 2). Free model only, tool-calling required;
  default `AIML_MODEL=openai/gpt-oss-20b`, env-swappable.
- **Persistence:** `db/migrations/0006_chat_sessions.sql` adds `chat_sessions`
  + `chat_messages` with owner-scoped RLS (`user_id = auth.uid()`) — the
  webapp's first *per-user* write path. `POST /api/chat` runs a bounded
  tool-calling loop server-side, persists the transcript, and titles the
  session from the first message. Per-message and per-conversation caps bound
  free-tier usage; token use is logged per turn.
- **Mood:** the chat reuses the homepage mascot's state machine
  (`src/lib/beleth.ts`) — the sprite in the header shows the current scene, and
  Beleth's tone tracks the day's P&L (happy / neutral / sad).
- **Config:** `AIML_API_KEY` (required, **server-only**, never `NEXT_PUBLIC_`).
  Without it the chat replies "not configured". `AIML_MODEL` / `AIML_BASE_URL`
  are optional (defaults in `src/lib/chat/aiml.ts`). AI/ML API's free tier has a
  small **daily request quota** — once it is spent the chat surfaces a clear
  "quota used up, try again later" message.

## Rendering model

The homepage is a server component with `export const revalidate = 60`: it is
prerendered, served from the CDN, and rebuilt at most once a minute — fresh
enough for a 5-minute cycle cadence, and judges always get a fast page. If
Supabase is unreachable or env is missing, the page renders with placeholder
counters and a visible `LIVE DATA UNAVAILABLE` note instead of failing.

### Alpaca-backed pieces (`src/lib/alpaca.ts`, server-only)

The equity curve, the MARKET OPEN/CLOSED chip, the live Equity / Day P&L
figures, and the filled-trade markers all read Alpaca **paper** endpoints
server-side (`/v2/account/portfolio/history`, `/v2/clock`, `/v2/account`,
`/v2/orders` + `/v2/positions`), cached 60 s. The client range switcher calls
`GET /api/equity?range=1D|1W|1M|ALL`, which runs the same server module.
Because `portfolio/history` only has completed market-hours bars, the chart
pins its final point to the live `/v2/account` equity so its "latest" always
matches the overview. Each of these is a soft dependency: if the Alpaca call
fails the chart / chip / markers just drop, the rest of the page is unaffected.
Alpaca paper keys are full trading keys (no read-only variant) — they are
server-only (**never** `NEXT_PUBLIC_*`) and belong only in encrypted env.

## Local development

```sh
npm install
cp .env.example .env.local   # fill in both values (see below)
npm run dev                  # http://localhost:3000
```

`NEXT_PUBLIC_SUPABASE_URL` is the Supabase project URL (same as the agent's
`SUPABASE_URL`). `NEXT_PUBLIC_SUPABASE_ANON_KEY` comes from the Supabase
dashboard (Project Settings → API Keys → the public *anon* / *publishable*
key). Both are public by design: visibility is enforced by the RLS policies in
`db/migrations/0003_anon_read_policies.sql`, not by key secrecy. Never put the
service-role key in this app.

`ALPACA_API_KEY` / `ALPACA_SECRET_KEY` (same values as the agent's) power the
equity chart, market-status chip and trade markers. They are read server-side
only — do **not** prefix them with `NEXT_PUBLIC_`. `ALPACA_API_BASE_URL` is an
optional override (defaults to the paper endpoint).

`AIML_API_KEY` (server-side only) enables "Chat with Beleth". `AIML_MODEL`
defaults to `openai/gpt-oss-20b`; `AIML_BASE_URL` to `https://api.aimlapi.com/v1`.
Apply `db/migrations/0006_chat_sessions.sql` to Supabase before using the chat.

## Deploy (Vercel)

1. Push this repo to GitHub.
2. vercel.com → **Add New… → Project** → import `Akaired/beleth-agent`.
3. **Root Directory**: `webapp` (framework auto-detects Next.js).
4. Environment variables (Production + Preview):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     (same two values back both the anon homepage and the authenticated
     dashboard — auth needs no extra env)
   - `ALPACA_API_KEY`
   - `ALPACA_SECRET_KEY`
     (server-side only — the equity chart, market-status chip and trade
     markers; **not** `NEXT_PUBLIC_`)
   - `AIML_API_KEY` (server-side only — "Chat with Beleth"; **not**
     `NEXT_PUBLIC_`). Optionally `AIML_MODEL` to override the default free model.
5. Apply `db/migrations/0006_chat_sessions.sql` to Supabase (SQL Editor).
6. Deploy. Every push to `main` deploys automatically.
7. Custom domain later: Project → Settings → Domains → `beleth.davidemaiorana.dev`
   (CNAME per Vercel's instructions).