-- 0028_forum_category_admin_only_topics.sql — per-category "admin starts topics".
--
-- Extends 0020 (forum administration). A category can be flagged
-- `admin_only_topics`: browsing and replying stay open to everyone, but a new
-- topic in that category may only be started by master_admin. Announcements /
-- changelog sections use it; the general discussion categories do not.
--
-- Enforced in the database, not just the UI:
--   * forum_categories gains `admin_only_topics boolean not null default false`.
--   * beleth_forum_category_upsert (0020) gains a p_admin_only_topics argument
--     so the admin modal can set it. Old 6-arg signature is dropped — the
--     webapp always sends the 7th key now.
--   * beleth_forum_create_topic (last set in 0025) raises 42501 when the target
--     category is locked and the caller is not master_admin.
--
-- The public webapp additionally hides the locked categories from the
-- new-topic picker and the "New topic" button for non-admins, but that is a
-- convenience — this function is the actual gate.
--
-- Idempotent: safe to re-run. Applied by hand:
--   uv run python scripts/apply_migration.py db/migrations/0028_forum_category_admin_only_topics.sql

-- ── 1. the flag ───────────────────────────────────────────────────────────
alter table public.forum_categories
    add column if not exists admin_only_topics boolean not null default false;

-- ── 2. category upsert gains the flag ─────────────────────────────────────
-- Body is 0020 §5 verbatim plus the new column. The old 6-arg overload is
-- dropped so only one signature exists.
drop function if exists public.beleth_forum_category_upsert(uuid, text, text, text, text, integer);

create or replace function public.beleth_forum_category_upsert(
    p_id                uuid,
    p_name              text,
    p_slug              text,
    p_description       text,
    p_color             text,
    p_position          integer,
    p_admin_only_topics boolean default false
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
  v_lock  boolean := coalesce(p_admin_only_topics, false);
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
    insert into public.forum_categories
      (slug, name, description, color, position, admin_only_topics)
    values (
      v_slug, btrim(p_name),
      nullif(btrim(coalesce(p_description, '')), ''),
      lower(v_color), coalesce(p_position, 0), v_lock
    )
    returning * into v_row;
  else
    update public.forum_categories
       set slug              = v_slug,
           name              = btrim(p_name),
           description        = nullif(btrim(coalesce(p_description, '')), ''),
           color             = lower(v_color),
           position          = coalesce(p_position, position),
           admin_only_topics = v_lock
     where id = p_id
    returning * into v_row;
    if not found then
      raise exception 'category % not found', p_id using errcode = 'P0002';
    end if;
  end if;

  return v_row;
end;
$$;

-- ── 3. create-topic honours the lock ─────────────────────────────────────
-- Body is 0025 §1b verbatim plus one guard right after the category check.
drop function if exists public.beleth_forum_create_topic(uuid, text, text, text);

create or replace function public.beleth_forum_create_topic(
    p_category_id  uuid,
    p_title        text,
    p_body         text,
    p_author_name  text default null
)
returns public.forum_topics
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_id    uuid := gen_random_uuid();
  v_base  text;
  v_slug  text;
  v_lock  boolean;
  v_topic public.forum_topics;
begin
  if v_uid is null then
    raise exception 'must be signed in to create a topic' using errcode = '42501';
  end if;
  if p_title is null or char_length(btrim(p_title)) < 3 or char_length(p_title) > 120 then
    raise exception 'title must be 3 to 120 characters' using errcode = '22023';
  end if;
  if p_body is null or char_length(btrim(p_body)) < 1 or char_length(p_body) > 8000 then
    raise exception 'body must be 1 to 8000 characters' using errcode = '22023';
  end if;

  select admin_only_topics into v_lock
    from public.forum_categories where id = p_category_id;
  if not found then
    raise exception 'unknown category' using errcode = '23503';
  end if;
  if coalesce(v_lock, false) and public.beleth_role() <> 'master_admin' then
    raise exception 'only admins may start a topic in this category'
      using errcode = '42501';
  end if;

  v_base := lower(regexp_replace(btrim(p_title), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base := btrim(v_base, '-');
  if v_base = '' then
    v_base := 'topic';
  end if;
  v_slug := left(v_base, 60) || '-' || substr(v_id::text, 1, 6);

  insert into public.forum_topics (id, category_id, slug, title, author_id, author_name, last_posted_at)
  values (v_id, p_category_id, v_slug, btrim(p_title), v_uid, coalesce(p_author_name, ''), now())
  returning * into v_topic;

  insert into public.forum_posts (topic_id, author_id, author_name, body)
  values (v_id, v_uid, coalesce(p_author_name, ''), btrim(p_body));

  return v_topic;
end;
$$;

-- ── 4. grants ────────────────────────────────────────────────────────────
revoke all on function
  public.beleth_forum_category_upsert(uuid, text, text, text, text, integer, boolean)
  from public, anon;
grant execute on function
  public.beleth_forum_category_upsert(uuid, text, text, text, text, integer, boolean)
  to authenticated;

revoke all on function
  public.beleth_forum_create_topic(uuid, text, text, text) from public, anon;
grant execute on function
  public.beleth_forum_create_topic(uuid, text, text, text) to authenticated;
