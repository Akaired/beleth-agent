-- 0009_forum_edit_delete.sql — authors can edit and delete their own content.
--
-- Extends 0008. A signed-in user may:
--   * edit the body of their own post (the topic's original post or any reply),
--   * delete their own reply,
--   * delete their own topic — which cascades to every post in it.
-- Nothing else about a post/topic is mutable from the client.
--
-- Same write model as 0008: no broad UPDATE/DELETE policy on the tables. Three
-- SECURITY DEFINER functions own the mutations, each checking
-- `author_id = auth.uid()` in its own body, so row/column scope is guaranteed
-- by the function, not a fragile per-column grant. `reply_count` /
-- `last_posted_at` are re-derived by an AFTER DELETE trigger.
--
-- Idempotent: safe to re-run. Applied by hand (Supabase SQL Editor) or
-- `uv run python scripts/apply_migration.py db/migrations/0009_forum_edit_delete.sql`.

-- ── edit a post body ───────────────────────────────────────────────────────
-- Only `body` changes; `updated_at` is bumped by the 0008 touch trigger, so the
-- UI can show an "edited" marker. Raises 42501 if the post is not the caller's.
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
  if p_body is null or char_length(btrim(p_body)) < 1 or char_length(p_body) > 8000 then
    raise exception 'body must be 1 to 8000 characters' using errcode = '22023';
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

-- ── delete one reply ───────────────────────────────────────────────────────
-- The original post (post_number = 1) cannot be removed on its own — deleting
-- the topic is the way to remove it.
create or replace function public.beleth_forum_delete_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_pn  integer;
  v_own uuid;
begin
  select post_number, author_id into v_pn, v_own
    from public.forum_posts where id = p_post_id;
  if not found then
    raise exception 'post not found' using errcode = 'P0002';
  end if;
  if v_uid is null or v_own <> v_uid then
    raise exception 'not your post' using errcode = '42501';
  end if;
  if v_pn = 1 then
    raise exception 'delete the topic to remove its original post';
  end if;

  delete from public.forum_posts where id = p_post_id;
end;
$$;

revoke all on function public.beleth_forum_delete_post(uuid) from public, anon;
grant execute on function public.beleth_forum_delete_post(uuid) to authenticated;

-- ── delete a whole topic (cascades to its posts) ──────────────────────────
create or replace function public.beleth_forum_delete_topic(p_topic_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_own uuid;
begin
  select author_id into v_own from public.forum_topics where id = p_topic_id;
  if not found then
    raise exception 'topic not found' using errcode = 'P0002';
  end if;
  if v_uid is null or v_own <> v_uid then
    raise exception 'not your topic' using errcode = '42501';
  end if;

  delete from public.forum_topics where id = p_topic_id;
end;
$$;

revoke all on function public.beleth_forum_delete_topic(uuid) from public, anon;
grant execute on function public.beleth_forum_delete_topic(uuid) to authenticated;

-- ── keep counters right after a reply is removed ──────────────────────────
-- Re-derives from scratch rather than decrementing, so it is correct no matter
-- how the delete happened. During a topic cascade the parent row is already
-- gone and the update simply hits no rows.
create or replace function public.beleth_forum_after_post_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.forum_topics
     set reply_count = (
           select count(*) from public.forum_posts
            where topic_id = old.topic_id and post_number > 1
         ),
         last_posted_at = coalesce(
           (select max(created_at) from public.forum_posts where topic_id = old.topic_id),
           last_posted_at
         )
   where id = old.topic_id;
  return null;
end;
$$;

drop trigger if exists trg_forum_posts_after_delete on public.forum_posts;
create trigger trg_forum_posts_after_delete
    after delete on public.forum_posts
    for each row execute function public.beleth_forum_after_post_delete();
