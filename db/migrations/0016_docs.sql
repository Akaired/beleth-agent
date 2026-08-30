-- 0016_docs.sql — the documentation section (milestone 9, "Documentation").
--
-- A small CMS for the project's own docs, modelled on Sybil's (its
-- sybil_docs_pages / sybil_docs_categories + docs-admin edge function). Beleth
-- has no edge functions and the webapp has no service-role client, so the
-- write path is the same one 0005 and 0008 established: SECURITY DEFINER
-- functions that check `beleth_role()` themselves and are the only writers.
--
--   * Two tables. `docs_categories` is a managed list (label + order); a
--     page's `category` is just the slug of a row in it, tied by an FK so a
--     page can never point at a category that doesn't exist and deleting a
--     category that still has pages fails loudly.
--   * Public read: anon + authenticated get every category and every
--     *published* page. Drafts are invisible without the service role.
--   * Writes: master_admin only, through the `beleth_docs_*` functions below.
--     There is deliberately NO insert/update/delete policy on either table —
--     column scope (status / published_at are never client-settable on
--     upsert) is guaranteed by the function bodies, not by per-column grants.
--   * The agent (service role) never touches these tables.
--
-- Content is authored later from /dashboard/admin/docs; the seed at the foot
-- gives judges a non-empty /docs on day one.
--
-- Idempotent: safe to re-run. Applied by hand:
--   uv run python scripts/apply_migration.py db/migrations/0016_docs.sql

-- ── 1. categories ──────────────────────────────────────────────────────────
create table if not exists public.docs_categories (
    id          uuid        primary key default gen_random_uuid(),
    slug        text        not null unique,
    label       text        not null,
    position    integer     not null default 0,        -- ascending sort in the nav
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists idx_docs_categories_position
    on public.docs_categories (position);

drop trigger if exists trg_docs_categories_touch_updated_at on public.docs_categories;
create trigger trg_docs_categories_touch_updated_at
    before update on public.docs_categories
    for each row execute function public.beleth_touch_updated_at();

alter table public.docs_categories enable row level security;

drop policy if exists "anyone reads docs categories" on public.docs_categories;
create policy "anyone reads docs categories"
    on public.docs_categories
    for select
    to anon, authenticated
    using (true);

-- ── 2. pages ───────────────────────────────────────────────────────────────
-- `content_md` is the single source of truth — no content_html column, the
-- webapp renders markdown at read time (public page + the editor's live
-- preview share one renderer). `status` is draft | published only; there is
-- no archived state for the hackathon.
create table if not exists public.docs_pages (
    id               uuid        primary key default gen_random_uuid(),
    slug             text        not null unique,
    category         text        not null references public.docs_categories (slug)
                                 on update cascade on delete restrict,
    title            text        not null,
    summary          text            null,
    content_md       text        not null default '',
    status           text        not null default 'draft'
                                 check (status in ('draft', 'published')),
    order_index      integer     not null default 0,   -- ascending within a category
    author_name      text            null,
    seo_title        text            null,
    seo_description  text            null,
    published_at     timestamptz     null,
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

create index if not exists idx_docs_pages_category_order
    on public.docs_pages (category, order_index);
create index if not exists idx_docs_pages_slug
    on public.docs_pages (slug);

drop trigger if exists trg_docs_pages_touch_updated_at on public.docs_pages;
create trigger trg_docs_pages_touch_updated_at
    before update on public.docs_pages
    for each row execute function public.beleth_touch_updated_at();

alter table public.docs_pages enable row level security;

drop policy if exists "anyone reads published docs pages" on public.docs_pages;
create policy "anyone reads published docs pages"
    on public.docs_pages
    for select
    to anon, authenticated
    using (status = 'published' and published_at is not null and published_at <= now());

-- ── 3. slug helper ─────────────────────────────────────────────────────────
-- Lowercase, collapse every run of non-alphanumerics (accents included) to a
-- single dash, trim, cap at 80 chars. Falls back to 'page' so it never
-- returns ''. No `unaccent` dependency — an accented char just becomes a
-- dash, which is good enough for a URL slug the editor previews live anyway.
create or replace function public.beleth_docs_slugify(p_text text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(
      btrim(
        regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'),
        '-'
      ),
      ''
    ),
    'page'
  );
$$;

-- ── 4. guard ───────────────────────────────────────────────────────────────
create or replace function public.beleth_docs_assert_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.beleth_role() <> 'master_admin' then
    raise exception 'only master_admin may edit documentation'
      using errcode = '42501';
  end if;
end;
$$;

-- ── 5. page writes ─────────────────────────────────────────────────────────
-- One upsert for create + edit. p_id null => insert as a draft. `status` and
-- `published_at` are never set here — that is beleth_docs_set_status's job.
-- The slug is derived from p_slug (or the title) and de-duplicated against
-- every other row.
create or replace function public.beleth_docs_upsert_page(
    p_id              uuid,
    p_title           text,
    p_slug            text,
    p_category        text,
    p_summary         text,
    p_content_md      text,
    p_order_index     integer,
    p_seo_title       text,
    p_seo_description text
)
returns public.docs_pages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base  text;
  v_slug  text;
  v_n     integer := 2;
  v_row   public.docs_pages;
begin
  perform public.beleth_docs_assert_admin();

  if p_title is null or char_length(btrim(p_title)) < 2 then
    raise exception 'title must be at least 2 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.docs_categories where slug = p_category) then
    raise exception 'unknown category %', p_category using errcode = '23503';
  end if;

  v_base := public.beleth_docs_slugify(coalesce(nullif(btrim(p_slug), ''), p_title));
  v_slug := v_base;
  while exists (
    select 1 from public.docs_pages
     where slug = v_slug and (p_id is null or id <> p_id)
  ) loop
    v_slug := v_base || '-' || v_n;
    v_n := v_n + 1;
  end loop;

  if p_id is null then
    insert into public.docs_pages
      (slug, category, title, summary, content_md, order_index, seo_title, seo_description)
    values
      (v_slug, p_category, btrim(p_title), nullif(btrim(coalesce(p_summary, '')), ''),
       coalesce(p_content_md, ''), coalesce(p_order_index, 0),
       nullif(btrim(coalesce(p_seo_title, '')), ''),
       nullif(btrim(coalesce(p_seo_description, '')), ''))
    returning * into v_row;
  else
    update public.docs_pages
       set slug            = v_slug,
           category        = p_category,
           title           = btrim(p_title),
           summary         = nullif(btrim(coalesce(p_summary, '')), ''),
           content_md      = coalesce(p_content_md, ''),
           order_index     = coalesce(p_order_index, 0),
           seo_title       = nullif(btrim(coalesce(p_seo_title, '')), ''),
           seo_description = nullif(btrim(coalesce(p_seo_description, '')), '')
     where id = p_id
    returning * into v_row;
    if not found then
      raise exception 'page % not found', p_id using errcode = 'P0002';
    end if;
  end if;

  return v_row;
end;
$$;

-- Flip draft <-> published. Publishing stamps published_at once and keeps it
-- across later unpublish/publish cycles (mirrors Sybil).
create or replace function public.beleth_docs_set_status(p_id uuid, p_status text)
returns public.docs_pages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.docs_pages;
begin
  perform public.beleth_docs_assert_admin();

  if p_status not in ('draft', 'published') then
    raise exception 'status must be draft or published' using errcode = '22023';
  end if;

  update public.docs_pages
     set status       = p_status,
         published_at = case
                          when p_status = 'published' then coalesce(published_at, now())
                          else published_at
                        end
   where id = p_id
  returning * into v_row;
  if not found then
    raise exception 'page % not found', p_id using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

create or replace function public.beleth_docs_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.beleth_docs_assert_admin();
  delete from public.docs_pages where id = p_id;
end;
$$;

-- Batch order_index write so a re-sort commits atomically.
create or replace function public.beleth_docs_reorder(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
begin
  perform public.beleth_docs_assert_admin();
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    update public.docs_pages
       set order_index = (v_item->>'order_index')::int
     where id = (v_item->>'id')::uuid;
  end loop;
end;
$$;

-- ── 6. category writes ─────────────────────────────────────────────────────
create or replace function public.beleth_docs_category_upsert(
    p_id       uuid,
    p_label    text,
    p_slug     text,
    p_position integer
)
returns public.docs_categories
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text;
  v_slug text;
  v_n    integer := 2;
  v_row  public.docs_categories;
begin
  perform public.beleth_docs_assert_admin();

  if p_label is null or char_length(btrim(p_label)) < 2 then
    raise exception 'label must be at least 2 characters' using errcode = '22023';
  end if;

  v_base := public.beleth_docs_slugify(coalesce(nullif(btrim(p_slug), ''), p_label));
  v_slug := v_base;
  while exists (
    select 1 from public.docs_categories
     where slug = v_slug and (p_id is null or id <> p_id)
  ) loop
    v_slug := v_base || '-' || v_n;
    v_n := v_n + 1;
  end loop;

  if p_id is null then
    insert into public.docs_categories (slug, label, position)
    values (v_slug, btrim(p_label), coalesce(p_position, 0))
    returning * into v_row;
  else
    -- A slug rename cascades onto docs_pages.category via the FK.
    update public.docs_categories
       set slug     = v_slug,
           label    = btrim(p_label),
           position = coalesce(p_position, position)
     where id = p_id
    returning * into v_row;
    if not found then
      raise exception 'category % not found', p_id using errcode = 'P0002';
    end if;
  end if;

  return v_row;
end;
$$;

create or replace function public.beleth_docs_category_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
begin
  perform public.beleth_docs_assert_admin();

  select slug into v_slug from public.docs_categories where id = p_id;
  if v_slug is null then
    return;
  end if;
  if exists (select 1 from public.docs_pages where category = v_slug) then
    raise exception 'category still has pages — move or delete them first'
      using errcode = '23503';
  end if;

  delete from public.docs_categories where id = p_id;
end;
$$;

create or replace function public.beleth_docs_category_reorder(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
begin
  perform public.beleth_docs_assert_admin();
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    update public.docs_categories
       set position = (v_item->>'position')::int
     where id = (v_item->>'id')::uuid;
  end loop;
end;
$$;

-- ── 7. admin reads ────────────────────────────────────────────────────────
-- The public RLS policy only exposes published pages; the admin list and the
-- editor need drafts too. These two SECURITY DEFINER readers return every
-- row to master_admin and nothing to anyone else — the webapp has no
-- service-role client to do this the direct way.
create or replace function public.beleth_docs_admin_list()
returns setof public.docs_pages
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.beleth_docs_assert_admin();
  return query
    select * from public.docs_pages
     order by category asc, order_index asc, created_at asc;
end;
$$;

create or replace function public.beleth_docs_admin_get(p_id uuid)
returns public.docs_pages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.docs_pages;
begin
  perform public.beleth_docs_assert_admin();
  select * into v_row from public.docs_pages where id = p_id;
  if not found then
    raise exception 'page % not found', p_id using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

-- ── 8. grants ──────────────────────────────────────────────────────────────
-- The functions gate on beleth_role() internally; execute is handed to
-- `authenticated` and pulled from anon/public.
revoke all on function public.beleth_docs_assert_admin() from public, anon;
revoke all on function public.beleth_docs_upsert_page(uuid, text, text, text, text, text, integer, text, text) from public, anon;
revoke all on function public.beleth_docs_set_status(uuid, text) from public, anon;
revoke all on function public.beleth_docs_delete(uuid) from public, anon;
revoke all on function public.beleth_docs_reorder(jsonb) from public, anon;
revoke all on function public.beleth_docs_category_upsert(uuid, text, text, integer) from public, anon;
revoke all on function public.beleth_docs_category_delete(uuid) from public, anon;
revoke all on function public.beleth_docs_category_reorder(jsonb) from public, anon;
revoke all on function public.beleth_docs_admin_list() from public, anon;
revoke all on function public.beleth_docs_admin_get(uuid) from public, anon;

grant execute on function public.beleth_docs_admin_list() to authenticated;
grant execute on function public.beleth_docs_admin_get(uuid) to authenticated;
grant execute on function public.beleth_docs_upsert_page(uuid, text, text, text, text, text, integer, text, text) to authenticated;
grant execute on function public.beleth_docs_set_status(uuid, text) to authenticated;
grant execute on function public.beleth_docs_delete(uuid) to authenticated;
grant execute on function public.beleth_docs_reorder(jsonb) to authenticated;
grant execute on function public.beleth_docs_category_upsert(uuid, text, text, integer) to authenticated;
grant execute on function public.beleth_docs_category_delete(uuid) to authenticated;
grant execute on function public.beleth_docs_category_reorder(jsonb) to authenticated;

-- ── 9. seed ────────────────────────────────────────────────────────────────
insert into public.docs_categories (slug, label, position) values
    ('overview',  'Overview',           0),
    ('strategy',  'Strategy',           1),
    ('operating', 'Operating the agent', 2),
    ('judges',    'For judges',         3)
on conflict (slug) do nothing;

-- Four published starter pages, one per category. Everything here is editable
-- afterwards from /dashboard/admin/docs.
insert into public.docs_pages
  (slug, category, title, summary, status, order_index, author_name, published_at, content_md)
values
  (
    'what-beleth-is', 'overview', 'What Beleth is',
    'An autonomous options-trading agent that trades a measured volatility risk premium on a paper account, under strict rules.',
    'published', 0, 'Beleth', now(),
    $md$Beleth is an autonomous agent that trades **options** on a dedicated Alpaca
**paper-trading** account. It has one job: sell a *measured* volatility risk
premium through defined-risk vertical spreads, and stay out of the market when
the premium is not there.

It is deliberately conservative. Every position has a known, capped maximum
loss before it is ever sent. Every order clears an explicit risk check first,
and the rejections are shown with the same weight as the fills — the "no"s are
the point, not an implementation detail.

## What it does not do

- No live trading. The account is paper, always.
- No naked legs and no unbounded loss — only single multi-leg vertical spreads.
- No promise that it cannot lose. Losses are normal and expected; what is
  fixed is the *size* of each one.

## How it is built

Two independent processes that only ever talk through a shared Supabase
database: the **agent** (a Python runner on a home server) writes every
decision, and this **webapp** reads them. If the agent's host goes offline the
dashboard still shows the last known state — only the production of new
decisions pauses.
$md$
  ),
  (
    'how-a-cycle-works', 'overview', 'How a cycle works',
    'One decision cycle: read the regime, scan the DTE ladder, size the spread, run the risk check, submit or explain the pass.',
    'published', 1, 'Beleth', now(),
    $md$Every cycle follows the same path, and every step is written to the decision
log whether or not a trade comes out of it.

1. **Read the regime.** Pull the VIX from FRED (`VIXCLS`) and place today on a
   one-year percentile. This is a regime read, not a signal — it scales
   position size and, at the extremes, blocks new premium entirely.
2. **Scan the DTE ladder.** Measure the volatility risk premium on each tenor
   in the ladder (7 / 14 / 21 / 30 / 45 days by default). Trade only the tenor
   whose premium clears its threshold.
3. **Check the gates.** Term-structure backwardation blocks new short premium.
   A known macro event inside the candidate's expiry blocks it too.
4. **Build the spread.** Pick strikes by delta, size the position against
   account equity and the aggregate-risk cap, and price the multi-leg order to
   fill.
5. **Risk check.** One explicit pass/fail against every rule. A rejection is
   logged in full and shown in the dashboard.
6. **Submit — or don't.** If nothing cleared, the cycle ends with a written
   reason. An agent that stays still is working correctly.
$md$
  ),
  (
    'the-volatility-risk-premium', 'strategy', 'The volatility risk premium',
    'Why implied volatility usually sits above what is realised, and how Beleth tries to collect the difference without taking unbounded risk.',
    'published', 0, 'Beleth', now(),
    $md$Option prices imply a future volatility. Realised volatility — what the
underlying actually does — is on average **lower**. That gap is the
volatility risk premium (VRP), and sellers of options are paid to carry it.

Beleth collects it with **short vertical credit spreads**: sell the nearer
strike, buy a further one for protection. The long leg caps the loss, which is
what makes the structure acceptable under the project's rules.

## The premium is not always there

The VRP shrinks, disappears, or inverts around stress. Beleth does not assume
it: it *measures* the premium on each tenor every cycle and only trades a
tenor that clears a configured threshold. Short-dated expiries were dropped
early on — the premium there is thin and unstable and gamma risk is high.

## The full reasoning

The strategy, organised by how much confidence each claim deserves — academic
research, industry convention, or our own choice — lives in the project's
`docs/strategy.md`, with a source on every line. The dashboard's **Strategy
strategy** page mirrors it.
$md$
  ),
  (
    'risk-checks-and-the-kill-switch', 'operating', 'Risk checks and the kill switch',
    'The explicit pre-trade check every order passes, and the master-admin control that halts new decisions.',
    'published', 0, 'Beleth', now(),
    $md$## The risk check

No order reaches Alpaca without passing an explicit check first. It verifies,
among other rules, that the structure is a defined-risk vertical, that the
per-trade maximum loss and the aggregate open risk are within their caps, that
the entry slippage is sane relative to the spread's credit, and that no gate
(term structure, macro event, VIX extreme) is tripped.

A failed check is not swallowed. It is written to the decision log with the
rule that failed and the numbers behind it, and it appears in the dashboard
next to the fills.

## The kill switch

The master-admin account can pause the agent from **Dashboard → Controls**. It
sets a single flag the runner reads at the top of every cycle and obeys
fail-closed: a paused agent produces no new decisions, only a heartbeat. Every
pause and resume is recorded in an audit trail. Unpausing lets the next cycle
run normally.
$md$
  ),
  (
    'reading-the-dashboard', 'judges', 'Reading the dashboard',
    'A 30-second tour of the public homepage and what each panel is telling you.',
    'published', 0, 'Beleth', now(),
    $md$The public homepage is built to be understood quickly.

- **Agent status.** Whether the agent is live, paused, or outside market
  hours, with the time of the last heartbeat.
- **Latest decision.** The most recent cycle in plain language — what it saw,
  what it concluded, and whether that produced a trade.
- **Equity curve.** The paper account's value over time, pulled straight from
  Alpaca, with markers for entries, exits, and closes.
- **Risk checks.** Recent pass/fail outcomes. A run of "no trade" is the
  strategy working, not a fault.

Signed in, the dashboard adds the full decision history, the raw model
reasoning behind each cycle, every reconstructed spread position, and the
strategy notes. The demo admin account sees all of it, read-only.
$md$
  )
on conflict (slug) do nothing;

notify pgrst, 'reload schema';
