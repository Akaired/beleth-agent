-- 0014_profile_self_service.sql — a user-editable profile: nickname, avatar, bio.
--
-- 0004 established public.profiles with the invariant that an authenticated user
-- can READ their own row but never write it (only the SECURITY DEFINER signup
-- trigger and the service role write). This migration keeps that invariant: it
-- adds three user-owned fields and exposes them through SECURITY DEFINER RPCs
-- that touch nothing else — role and email stay untouchable from the webapp.
--
--   display_name  a chosen nickname (2..40 chars). When set it replaces the
--                 email local-part everywhere the UI shows an identity, and it
--                 is denormalised onto forum_topics/forum_posts.author_name.
--   avatar_url    public URL of an image in the `avatars` storage bucket.
--   bio           a short free-text blurb (<= 280 chars), shown on the account
--                 page only for now.
--
-- Idempotent: safe to re-run.

-- ── 1. new columns ──────────────────────────────────────────────────────────
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists avatar_url   text;
alter table public.profiles add column if not exists bio          text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_display_name_len'
  ) then
    alter table public.profiles add constraint profiles_display_name_len
      check (display_name is null or char_length(display_name) between 2 and 40);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_bio_len'
  ) then
    alter table public.profiles add constraint profiles_bio_len
      check (bio is null or char_length(bio) <= 280);
  end if;
end $$;

-- ── 2. update-profile RPC ───────────────────────────────────────────────────
-- Trims input; an empty string clears the field back to NULL. Also keeps the
-- denormalised forum author_name in sync for the caller's own posts, so a
-- nickname change is reflected on old threads too.
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
  v_uid  uuid := (select auth.uid());
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_bio  text := nullif(btrim(coalesce(p_bio, '')), '');
  v_row  public.profiles;
  v_stamp text;
begin
  if v_uid is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
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

  -- Denormalised author label used by the forum lists.
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

-- ── 3. set-avatar RPC ───────────────────────────────────────────────────────
-- Accepts NULL (clear) or a public URL that points into the `avatars` bucket.
-- The file itself is protected by the storage RLS below (only the owning
-- folder is writable), so this only needs a light shape check.
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

-- ── 4. avatars storage bucket ───────────────────────────────────────────────
-- Public read; an authenticated user may write/replace/delete only inside a
-- top-level folder named with their own uid. Mirrors `forum-media` (0010).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true, 2097152,
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars public read" on storage.objects;
create policy "avatars public read"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'avatars');

drop policy if exists "avatars owner insert" on storage.objects;
create policy "avatars owner insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars owner delete" on storage.objects;
create policy "avatars owner delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ── 5. forum author stamp prefers the nickname ─────────────────────────────
create or replace function public.beleth_forum_stamp_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.author_id := (select auth.uid());
  new.author_name := coalesce(
    nullif(btrim((select display_name from public.profiles
                   where user_id = new.author_id)), ''),
    split_part((select email from auth.users where id = new.author_id), '@', 1),
    'someone'
  );
  return new;
end;
$$;

-- Backfill existing forum rows for users who already have a nickname.
update public.forum_topics t
   set author_name = nullif(btrim(p.display_name), '')
  from public.profiles p
 where p.user_id = t.author_id
   and nullif(btrim(p.display_name), '') is not null;

update public.forum_posts fp
   set author_name = nullif(btrim(p.display_name), '')
  from public.profiles p
 where p.user_id = fp.author_id
   and nullif(btrim(p.display_name), '') is not null;
