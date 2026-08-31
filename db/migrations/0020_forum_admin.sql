-- 0020_forum_admin.sql — forum administration (milestone 9, "Forum" admin tab).
--
-- Extends 0008–0010. Adds the write path the seeded forum never had: category
-- CRUD + reorder, and topic moderation (move between categories, pin, close,
-- rename, delete any topic or post). Modelled on Discourse's category and
-- moderation tools, scoped to what a hackathon forum needs.
--
-- Same write model as 0005 / 0008 / 0016: the webapp has NO service-role
-- client, so every admin mutation goes through a `beleth_forum_admin_*` /
-- `beleth_forum_category_*` SECURITY DEFINER function that re-checks
-- `beleth_role() = 'master_admin'` in its own body. There is deliberately NO
-- broad INSERT/UPDATE/DELETE policy on forum_categories / forum_topics /
-- forum_posts — column scope is guaranteed by the function bodies.
--
--   * forum_topics gains `pinned` and `closed` booleans. Pinned topics sort
--     first in the public lists; a closed topic takes no new replies (the
--     0008 INSERT policy on forum_posts is recreated below to enforce it).
--   * forum_topics.category_id is a uuid FK, NOT the slug (unlike docs), so a
--     category slug rename needs no cascade.
--   * The agent (service role) never touches these tables.
--
-- Idempotent: safe to re-run. Applied by hand:
--   uv run python scripts/apply_migration.py db/migrations/0020_forum_admin.sql

-- ── 1. topic flags ─────────────────────────────────────────────────────────
alter table public.forum_topics
    add column if not exists pinned boolean not null default false;
alter table public.forum_topics
    add column if not exists closed boolean not null default false;

drop index if exists idx_forum_topics_category_activity;
create index if not exists idx_forum_topics_category_pinned_activity
    on public.forum_topics (category_id, pinned desc, last_posted_at desc);
create index if not exists idx_forum_topics_pinned_activity
    on public.forum_topics (pinned desc, last_posted_at desc);

-- ── 2. closed topics take no new replies ───────────────────────────────────
-- Recreate the 0008 INSERT policy on forum_posts with a closed-topic guard.
-- author_id is still stamped by the BEFORE-INSERT trigger, so the client
-- insert that omits it continues to satisfy `author_id = auth.uid()`.
drop policy if exists "authenticated create forum posts" on public.forum_posts;
create policy "authenticated create forum posts"
    on public.forum_posts
    for insert
    to authenticated
    with check (
        author_id = (select auth.uid())
        and exists (
            select 1 from public.forum_topics t
             where t.id = topic_id and t.closed = false
        )
    );

-- ── 3. admin guard ────────────────────────────────────────────────────────
create or replace function public.beleth_forum_assert_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.beleth_role() <> 'master_admin' then
    raise exception 'only master_admin may administer the forum'
      using errcode = '42501';
  end if;
end;
$$;

-- ── 4. slug helper ────────────────────────────────────────────────────────
-- Lowercase, collapse runs of non-alphanumerics to a single dash, trim, cap
-- at 60 chars. Falls back to 'section' so it never returns ''.
create or replace function public.beleth_forum_slugify(p_text text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(
      btrim(
        left(regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'), 60),
        '-'
      ),
      ''
    ),
    'section'
  );
$$;

-- ── 5. category writes ────────────────────────────────────────────────────
-- One upsert for create + edit. p_id null => insert. The slug is derived from
-- p_slug (or the name) and de-duplicated. A slug rename is safe: forum_topics
-- references category_id, not the slug.
create or replace function public.beleth_forum_category_upsert(
    p_id          uuid,
    p_name        text,
    p_slug        text,
    p_description text,
    p_color       text,
    p_position    integer
)
returns public.forum_categories
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base  text;
  v_slug  text;
  v_n     integer := 2;
  v_color text;
  v_row   public.forum_categories;
begin
  perform public.beleth_forum_assert_admin();

  if p_name is null or char_length(btrim(p_name)) < 2 or char_length(btrim(p_name)) > 40 then
    raise exception 'name must be 2 to 40 characters' using errcode = '22023';
  end if;

  v_color := coalesce(nullif(btrim(coalesce(p_color, '')), ''), '#d9a03c');
  if v_color !~ '^#[0-9a-fA-F]{6}$' then
    raise exception 'color must be a 6-digit hex like #d9a03c' using errcode = '22023';
  end if;

  v_base := public.beleth_forum_slugify(coalesce(nullif(btrim(p_slug), ''), p_name));
  v_slug := v_base;
  while exists (
    select 1 from public.forum_categories
     where slug = v_slug and (p_id is null or id <> p_id)
  ) loop
    v_slug := v_base || '-' || v_n;
    v_n := v_n + 1;
  end loop;

  if p_id is null then
    insert into public.forum_categories (slug, name, description, color, position)
    values (
      v_slug, btrim(p_name),
      nullif(btrim(coalesce(p_description, '')), ''),
      lower(v_color), coalesce(p_position, 0)
    )
    returning * into v_row;
  else
    update public.forum_categories
       set slug        = v_slug,
           name        = btrim(p_name),
           description  = nullif(btrim(coalesce(p_description, '')), ''),
           color       = lower(v_color),
           position    = coalesce(p_position, position)
     where id = p_id
    returning * into v_row;
    if not found then
      raise exception 'category % not found', p_id using errcode = 'P0002';
    end if;
  end if;

  return v_row;
end;
$$;

create or replace function public.beleth_forum_category_delete(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.beleth_forum_assert_admin();

  if not exists (select 1 from public.forum_categories where id = p_id) then
    return;
  end if;
  if exists (select 1 from public.forum_topics where category_id = p_id) then
    raise exception 'category still has topics — move or delete them first'
      using errcode = '23503';
  end if;

  delete from public.forum_categories where id = p_id;
end;
$$;

-- Batch position write so a re-sort commits atomically.
create or replace function public.beleth_forum_category_reorder(p_items jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
begin
  perform public.beleth_forum_assert_admin();
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    update public.forum_categories
       set position = (v_item->>'position')::int
     where id = (v_item->>'id')::uuid;
  end loop;
end;
$$;

-- ── 6. topic moderation ──────────────────────────────────────────────────
-- One update for every moderator field. A null argument leaves that field
-- untouched, so the webapp can send just the one thing that changed.
create or replace function public.beleth_forum_admin_update_topic(
    p_topic_id    uuid,
    p_category_id uuid     default null,
    p_pinned      boolean  default null,
    p_closed      boolean  default null,
    p_title       text     default null
)
returns public.forum_topics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.forum_topics;
begin
  perform public.beleth_forum_assert_admin();

  if p_category_id is not null
     and not exists (select 1 from public.forum_categories where id = p_category_id) then
    raise exception 'unknown category' using errcode = '23503';
  end if;
  if p_title is not null
     and (char_length(btrim(p_title)) < 3 or char_length(btrim(p_title)) > 120) then
    raise exception 'title must be 3 to 120 characters' using errcode = '22023';
  end if;

  update public.forum_topics
     set category_id = coalesce(p_category_id, category_id),
         pinned      = coalesce(p_pinned, pinned),
         closed      = coalesce(p_closed, closed),
         title       = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title)
   where id = p_topic_id
  returning * into v_row;
  if not found then
    raise exception 'topic % not found', p_topic_id using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

create or replace function public.beleth_forum_admin_delete_topic(p_topic_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.beleth_forum_assert_admin();
  delete from public.forum_topics where id = p_topic_id;
end;
$$;

-- Delete any single reply. The original post (post_number = 1) can only go by
-- deleting the topic; the 0009 AFTER DELETE trigger re-derives the counters.
create or replace function public.beleth_forum_admin_delete_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pn integer;
begin
  perform public.beleth_forum_assert_admin();

  select post_number into v_pn from public.forum_posts where id = p_post_id;
  if not found then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  if v_pn = 1 then
    raise exception 'delete the topic to remove its original post';
  end if;

  delete from public.forum_posts where id = p_post_id;
end;
$$;

-- ── 7. grants ────────────────────────────────────────────────────────────
-- The functions gate on beleth_role() internally; execute is handed to
-- `authenticated` and pulled from anon/public.
revoke all on function public.beleth_forum_assert_admin() from public, anon;
revoke all on function public.beleth_forum_slugify(text) from public, anon;
revoke all on function public.beleth_forum_category_upsert(uuid, text, text, text, text, integer) from public, anon;
revoke all on function public.beleth_forum_category_delete(uuid) from public, anon;
revoke all on function public.beleth_forum_category_reorder(jsonb) from public, anon;
revoke all on function public.beleth_forum_admin_update_topic(uuid, uuid, boolean, boolean, text) from public, anon;
revoke all on function public.beleth_forum_admin_delete_topic(uuid) from public, anon;
revoke all on function public.beleth_forum_admin_delete_post(uuid) from public, anon;

grant execute on function public.beleth_forum_category_upsert(uuid, text, text, text, text, integer) to authenticated;
grant execute on function public.beleth_forum_category_delete(uuid) to authenticated;
grant execute on function public.beleth_forum_category_reorder(jsonb) to authenticated;
grant execute on function public.beleth_forum_admin_update_topic(uuid, uuid, boolean, boolean, text) to authenticated;
grant execute on function public.beleth_forum_admin_delete_topic(uuid) to authenticated;
grant execute on function public.beleth_forum_admin_delete_post(uuid) to authenticated;
