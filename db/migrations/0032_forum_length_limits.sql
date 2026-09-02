-- 0032_forum_length_limits.sql — one body ceiling, enforced where it cannot be skipped.
--
-- Three limits that should have been one:
--
--   * `beleth_forum_create_topic` rejected a body over 8000 characters. 0010 had raised
--     that ceiling to 100000 for both create and edit; 0028 recreated the function from
--     an older body and silently took the 8000 back. `beleth_forum_edit_post` still says
--     100000, so the same post could be edited to a length it could not be written at.
--   * `webapp/src/lib/forum/actions.ts` validates against 100000, so a body between 8001
--     and 100000 passed the app and was refused by the database — the user saw a raw
--     Postgres error rather than a validation message.
--   * A reply is inserted straight into `forum_posts` under RLS, with no function in the
--     way, so its body had no database-side ceiling at all. Self-signup is open and
--     PostgREST is reachable with the anon key, so the app's limit was the only one and
--     it could be walked around.
--
-- A CHECK constraint on the column is the only place all three paths meet. 100000 is the
-- number the rest of the system already used; the longest body in the table today is
-- around 3.4k, so the constraint validates against existing rows.
--
-- Idempotent.

-- ── 1. the column-level ceiling every path passes through ────────────────────
alter table public.forum_posts
  drop constraint if exists forum_posts_body_length;
alter table public.forum_posts
  add constraint forum_posts_body_length
  check (char_length(body) between 1 and 100000);

alter table public.forum_topics
  drop constraint if exists forum_topics_title_length;
alter table public.forum_topics
  add constraint forum_topics_title_length
  check (char_length(btrim(title)) between 3 and 120);

-- Display names are cosmetic and denormalised onto every row; keep them bounded too.
alter table public.forum_topics
  drop constraint if exists forum_topics_author_name_length;
alter table public.forum_topics
  add constraint forum_topics_author_name_length
  check (char_length(author_name) <= 60);

alter table public.forum_posts
  drop constraint if exists forum_posts_author_name_length;
alter table public.forum_posts
  add constraint forum_posts_author_name_length
  check (char_length(author_name) <= 60);

-- ── 2. undo the 8000 regression in create_topic ──────────────────────────────
-- Body copied verbatim from the live definition; only the body ceiling changes.
create or replace function public.beleth_forum_create_topic(
    p_category_id uuid,
    p_title text,
    p_body text,
    p_author_name text default null::text
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
  -- 100000, matching beleth_forum_edit_post and the constraint above.
  if p_body is null or char_length(btrim(p_body)) < 1 or char_length(p_body) > 100000 then
    raise exception 'body must be 1 to 100000 characters' using errcode = '22023';
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

revoke all on function public.beleth_forum_create_topic(uuid, text, text, text) from public, anon;
grant execute on function public.beleth_forum_create_topic(uuid, text, text, text) to authenticated;
