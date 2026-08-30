-- 0010_forum_rich_content.sql — rich-text forum posts + image uploads.
--
-- Posts move from plain text to a small allowlisted HTML subset produced by a
-- WYSIWYG editor (Quill) in the webapp. The HTML is sanitised server-side
-- (webapp: src/lib/forum/sanitize.ts) BEFORE it reaches the database, and again
-- on render as defence in depth. Nothing about the storage model changes:
-- `forum_posts.body` / the create-topic body param just hold sanitised HTML now.
--
-- Two changes:
--   1. Raise the body length ceiling in the create / edit functions from 8000
--      to 100000 — HTML markup is bulkier than the prose it wraps.
--   2. Add a public Storage bucket `forum-media` for images dropped into a post,
--      with anon read and per-user-folder authenticated upload.
--
-- Idempotent: safe to re-run.

-- ── 1. wider body ceiling ─────────────────────────────────────────────────
create or replace function public.beleth_forum_create_topic(
    p_category_id uuid,
    p_title       text,
    p_body        text
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
  v_topic public.forum_topics;
begin
  if v_uid is null then
    raise exception 'must be signed in to create a topic' using errcode = '42501';
  end if;
  if p_title is null or char_length(btrim(p_title)) < 3 or char_length(p_title) > 120 then
    raise exception 'title must be 3 to 120 characters' using errcode = '22023';
  end if;
  if p_body is null or char_length(btrim(p_body)) < 1 or char_length(p_body) > 100000 then
    raise exception 'body must be 1 to 100000 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from public.forum_categories where id = p_category_id) then
    raise exception 'unknown category' using errcode = '23503';
  end if;

  v_base := lower(regexp_replace(btrim(p_title), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base := btrim(v_base, '-');
  if v_base = '' then
    v_base := 'topic';
  end if;
  v_slug := left(v_base, 60) || '-' || substr(v_id::text, 1, 6);

  insert into public.forum_topics (id, category_id, slug, title, author_id, last_posted_at)
  values (v_id, p_category_id, v_slug, btrim(p_title), v_uid, now())
  returning * into v_topic;

  insert into public.forum_posts (topic_id, author_id, body)
  values (v_id, v_uid, btrim(p_body));

  return v_topic;
end;
$$;

revoke all on function public.beleth_forum_create_topic(uuid, text, text) from public, anon;
grant execute on function public.beleth_forum_create_topic(uuid, text, text) to authenticated;

create or replace function public.beleth_forum_edit_post(
    p_post_id uuid,
    p_body    text
)
returns public.forum_posts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.forum_posts;
begin
  if v_uid is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  if p_body is null or char_length(btrim(p_body)) < 1 or char_length(p_body) > 100000 then
    raise exception 'body must be 1 to 100000 characters' using errcode = '22023';
  end if;

  update public.forum_posts
     set body = btrim(p_body)
   where id = p_post_id
     and author_id = v_uid
  returning * into v_row;

  if not found then
    raise exception 'post not found or not yours' using errcode = '42501';
  end if;
  return v_row;
end;
$$;

revoke all on function public.beleth_forum_edit_post(uuid, text) from public, anon;
grant execute on function public.beleth_forum_edit_post(uuid, text) to authenticated;

-- ── 2. image bucket ──────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'forum-media', 'forum-media', true, 5242880,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Anyone can read (the bucket is public); an authenticated user may upload only
-- into a top-level folder named with their own uid.
drop policy if exists "forum media public read" on storage.objects;
create policy "forum media public read"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'forum-media');

drop policy if exists "forum media owner upload" on storage.objects;
create policy "forum media owner upload"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'forum-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "forum media owner delete" on storage.objects;
create policy "forum media owner delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'forum-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
