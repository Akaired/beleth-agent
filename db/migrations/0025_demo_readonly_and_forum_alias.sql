-- 0025_demo_readonly_and_forum_alias.sql — the shared judges' demo account.
--
-- `demo_admin` is a single shared login handed to hackathon judges. It may see
-- everything the backoffice shows (decisions, raw LLM reasoning, risk-check
-- detail, logs, admin views) but it must never *touch* anything — no kill
-- switch (already master_admin-only, 0005), no config, no user management
-- (0019), no forum administration (0020).
--
-- The ONE exception is the public forum: a judge may open a topic and post
-- replies, but under a per-post alias typed into a blocking modal in the webapp,
-- always suffixed " (demo)" so the shared account is never mistaken for a real
-- member.
--
-- Two parts:
--   1. Forum author stamp — a `demo_admin`'s posts keep the client-supplied
--      alias (sanitised, "(demo)"-marked); every other account is stamped from
--      the profile nickname / email exactly as before (supersedes 0014 §5).
--   2. The self-service RPCs (0014 / 0023) refuse a `demo_admin` caller, so the
--      demo cannot rename itself, change its avatar, or deactivate / delete
--      itself. Password change is a GoTrue call with no RPC to guard — it is
--      blocked in the webapp action instead.
--
-- Idempotent: safe to re-run. Applied by hand:
--   python3 scripts/apply_migration.py db/migrations/0025_demo_readonly_and_forum_alias.sql

-- ── 0. shared guard ───────────────────────────────────────────────────────
-- Raises 42501 when the caller is the read-only demo account. SECURITY DEFINER
-- so it can read the caller's role regardless of RLS.
create or replace function public.beleth_assert_not_demo()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.beleth_role() = 'demo_admin' then
    raise exception 'the demo account is read-only'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.beleth_assert_not_demo() from public, anon;
grant execute on function public.beleth_assert_not_demo() to authenticated;

-- ── 1. forum author stamp — demo alias branch ────────────────────────────
-- Supersedes 0014 §5. Non-demo behaviour is unchanged: the trigger owns
-- author_name (nickname → email local-part → 'someone') and any client-sent
-- value is ignored. A demo_admin instead posts under the alias it typed into
-- the webapp modal, which arrives on new.author_name; it is trimmed, collapsed,
-- capped at 40 chars and always marked " (demo)".
create or replace function public.beleth_forum_stamp_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_alias text;
begin
  new.author_id := v_uid;

  if public.beleth_role() = 'demo_admin' then
    v_alias := regexp_replace(btrim(coalesce(new.author_name, '')), '\s+', ' ', 'g');
    if char_length(v_alias) < 2 then
      v_alias := 'Guest';
    end if;
    new.author_name := left(v_alias, 40) || ' (demo)';
  else
    new.author_name := coalesce(
      nullif(btrim((select display_name from public.profiles
                     where user_id = v_uid)), ''),
      split_part((select email from auth.users where id = v_uid), '@', 1),
      'someone'
    );
  end if;

  return new;
end;
$$;

-- ── 1b. beleth_forum_create_topic gains an optional alias ────────────────
-- Supersedes 0008 §6. The atomic topic+first-post creator now takes an
-- optional p_author_name and writes it onto both rows so the BEFORE trigger
-- above can pick it up (only a demo_admin's value survives; for everyone else
-- the trigger overwrites it). The 3-arg call sites keep working — PostgREST
-- resolves the RPC by the keys it sends and lets the 4th argument default.
-- The old 3-arg signature is dropped so only one overload exists.
drop function if exists public.beleth_forum_create_topic(uuid, text, text);

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
  if not exists (select 1 from public.forum_categories where id = p_category_id) then
    raise exception 'unknown category' using errcode = '23503';
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

-- ── 2. self-service RPCs refuse the demo account ─────────────────────────
-- Each body is 0014 / 0023 verbatim with one added line right after the
-- signed-in check: `perform public.beleth_assert_not_demo();`.

-- 2a. nickname + bio (0014 §2) ------------------------------------------------
create or replace function public.beleth_update_profile(
    p_display_name text,
    p_bio          text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_name  text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_bio   text := nullif(btrim(coalesce(p_bio, '')), '');
  v_row   public.profiles;
  v_stamp text;
begin
  if v_uid is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  perform public.beleth_assert_not_demo();
  if v_name is not null and char_length(v_name) not between 2 and 40 then
    raise exception 'nickname must be 2 to 40 characters' using errcode = '22023';
  end if;
  if v_bio is not null and char_length(v_bio) > 280 then
    raise exception 'bio must be 280 characters or fewer' using errcode = '22023';
  end if;

  update public.profiles
     set display_name = v_name,
         bio          = v_bio
   where user_id = v_uid
  returning * into v_row;

  if not found then
    raise exception 'no profile row' using errcode = 'P0002';
  end if;

  v_stamp := coalesce(
    v_name,
    split_part((select email from auth.users where id = v_uid), '@', 1),
    'someone'
  );
  update public.forum_topics set author_name = v_stamp where author_id = v_uid;
  update public.forum_posts  set author_name = v_stamp where author_id = v_uid;

  return v_row;
end;
$$;

revoke all on function public.beleth_update_profile(text, text) from public, anon;
grant execute on function public.beleth_update_profile(text, text) to authenticated;

-- 2b. avatar url (0014 §3) --------------------------------------------------
create or replace function public.beleth_set_avatar_url(p_url text)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_url text := nullif(btrim(coalesce(p_url, '')), '');
  v_row public.profiles;
begin
  if v_uid is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  perform public.beleth_assert_not_demo();
  if v_url is not null
     and position('/storage/v1/object/public/avatars/' in v_url) = 0 then
    raise exception 'avatar url must point into the avatars bucket'
      using errcode = '22023';
  end if;

  update public.profiles
     set avatar_url = v_url
   where user_id = v_uid
  returning * into v_row;

  if not found then
    raise exception 'no profile row' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke all on function public.beleth_set_avatar_url(text) from public, anon;
grant execute on function public.beleth_set_avatar_url(text) to authenticated;

-- 2c. deactivate (0023 §3) -----------------------------------------------------
create or replace function public.beleth_deactivate_account()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.profiles;
begin
  if v_uid is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  perform public.beleth_assert_not_demo();

  select * into v_row from public.profiles where user_id = v_uid;
  if not found then
    raise exception 'no profile row' using errcode = 'P0002';
  end if;
  if v_row.role = 'master_admin' then
    raise exception 'the master admin account cannot be deactivated from the webapp'
      using errcode = '42501';
  end if;

  update public.profiles
     set status = 'deactivated',
         deactivated_at = now()
   where user_id = v_uid
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.beleth_deactivate_account() from public, anon;
grant execute on function public.beleth_deactivate_account() to authenticated;

-- 2d. delete (0023 §4) -------------------------------------------------------
create or replace function public.beleth_delete_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_role text;
begin
  if v_uid is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  perform public.beleth_assert_not_demo();

  select role into v_role from public.profiles where user_id = v_uid;
  if v_role = 'master_admin' then
    raise exception 'the master admin account cannot be deleted from the webapp'
      using errcode = '42501';
  end if;

  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.beleth_delete_account() from public, anon;
grant execute on function public.beleth_delete_account() to authenticated;

-- ── 3. reload PostgREST schema cache ─────────────────────────────────────
notify pgrst, 'reload schema';
