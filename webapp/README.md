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
- `src/lib/dashboard-queries.ts` — authenticated reads (overview, decision history/detail, strategy snapshot)
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
| `master_admin` | the above **plus** operational control (pause, config edit, Alpaca) | manual, same way — **write paths not built yet** |

Role changes are out of band: no RLS policy lets a user change their own role,
and the webapp never can. `db/migrations/0004_auth_roles.sql` adds the table,
the signup trigger, and the `public.beleth_role()` helper.

### Project auth config (set via the Management API / PAT)

- `mailer_autoconfirm = true` — **temporary.** Lets email+password signup work
  without SMTP. Revisit when Resend + magic link land: set it back to `false`
  and wire a custom SMTP sender.
- `site_url` = the Vercel production URL; `uri_allow_list` covers localhost,
  Vercel previews, and the custom domain.

## Rendering model

The homepage is a server component with `export const revalidate = 60`: it is
prerendered, served from the CDN, and rebuilt at most once a minute — fresh
enough for a 5-minute cycle cadence, and judges always get a fast page. If
Supabase is unreachable or env is missing, the page renders with placeholder
counters and a visible `LIVE DATA UNAVAILABLE` note instead of failing.

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

## Deploy (Vercel)

1. Push this repo to GitHub.
2. vercel.com → **Add New… → Project** → import `Akaired/beleth-agent`.
3. **Root Directory**: `webapp` (framework auto-detects Next.js).
4. Environment variables (Production + Preview):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (same two values back both the anon homepage and the authenticated
   dashboard — auth needs no extra env)
5. Deploy. Every push to `main` deploys automatically.
6. Custom domain later: Project → Settings → Domains → `beleth.davidemaiorana.dev`
   (CNAME per Vercel's instructions).