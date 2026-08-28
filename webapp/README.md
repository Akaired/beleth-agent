# Beleth webapp

The public showcase for the Beleth agent: a Next.js (App Router) app that reads
the decision log the agent persists to Supabase. **Reads only** — the agent owns
every write.

## Layout

- `src/app/` — pages (public homepage today; authenticated dashboard later)
- `src/components/` — hand-written components matching the approved design mockup
- `src/lib/supabase.ts` — minimal typed PostgREST reader (no supabase-js yet)
- `src/lib/queries.ts` — typed homepage reads + evidence-package mapping
- `public/beleth.png`, `public/beleth-animated.svg` — the mascot

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
5. Deploy. Every push to `main` deploys automatically.
6. Custom domain later: Project → Settings → Domains → `beleth.davidemaiorana.dev`
   (CNAME per Vercel's instructions).