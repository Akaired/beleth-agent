-- 0023_account_lifecycle.sql — public profiles + account deactivation / deletion.
--
-- Three additions, all keeping the 0004 invariant (an authenticated user can
-- READ their own profile row but never write it — the only writers are the
-- SECURITY DEFINER RPCs and the service role):
--
--   1. A read path for OTHER users' profiles. Clicking a name in the forum
--      opens /u/<id>; that page needs a safe public subset of the target's
--      profile. `beleth_public_profile()` returns exactly that subset
--      (nickname, avatar, bio, member-since, XP, streak) and never the email
--      or role. RLS on `profiles` stays "own row only".
--
--   2. Account deactivation. `profiles.status` flips to 'deactivated' and the
--      webapp bounces the user to a terminal /account-deactivated screen with
--      a "reactivate" button. Nothing is deleted; it is reversible.
--
--   3. Account deletion. `beleth_delete_account()` removes the caller's
--      auth.users row; every user-owned table (profiles, user_progress,
--      forum_topics, forum_posts, chat_sessions, chat_messages) is
--      `on delete cascade` on auth.users, so the row goes and its data with
--      it. No edge function — the webapp has no service-role client, and this
--      keeps every mutation a SECURITY DEFINER RPC.
--
-- The master-admin account (the judges' demo login) cannot deactivate or
-- delete itself through the webapp — losing it mid-hackathon would take the
-- backoffice offline. Both RPCs refuse that role.
--
-- Idempotent: safe to re-run.

-- ── 1. profiles: lifecycle columns ─────────────────────────────────────────
alter table public.profiles
  add column if not exists status text not null default 'active';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_status_check'
  ) then
    alter table public.profiles add constraint profiles_status_check
      check (status in ('active', 'deactivated'));
  end if;
end $$;

alter table public.profiles
  add column if not exists deactivated_at timestamptz;

-- ── 2. public profile read ─────────────────────────────────────────────────
-- SECURITY DEFINER so it can see any profile row regardless of the caller's
-- RLS view, but it hand-picks the columns that are safe to expose. Email and
-- role are deliberately absent. A deactivated account still resolves, with
-- is_deactivated = true, so the profile page can show a tombstone instead of
-- a 404.
create or replace function public.beleth_public_profile(p_user_id uuid)
returns table (
  user_id        uuid,
  display_name   text,
  avatar_url     text,
  bio            text,
  created_at     timestamptz,
  xp             integer,
  streak_days    integer,
  is_deactivated boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.user_id,
    coalesce(
      nullif(btrim(p.display_name), ''),
      split_part((select email from auth.users u where u.id = p.user_id), '@', 1),
      'someone'
    )                                        as display_name,
    p.avatar_url,
    p.bio,
    p.created_at,
    coalesce(pr.xp, 0)                       as xp,
    coalesce(pr.streak_days, 0)              as streak_days,
    (p.status = 'deactivated')               as is_deactivated
  from public.profiles p
  left join public.user_progress pr on pr.user_id = p.user_id
  where p.user_id = p_user_id;
$$;

revoke all on function public.beleth_public_profile(uuid) from public;
grant execute on function public.beleth_public_profile(uuid) to anon, authenticated;

-- ── 3. deactivate / reactivate ─────────────────────────────────────────────
create or replace function public.beleth_deactivate_account()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_row  public.profiles;
begin
  if v_uid is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;

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

create or replace function public.beleth_reactivate_account()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_row  public.profiles;
begin
  if v_uid is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;

  update public.profiles
     set status = 'active',
         deactivated_at = null
   where user_id = v_uid
  returning * into v_row;

  if not found then
    raise exception 'no profile row' using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke all on function public.beleth_reactivate_account() from public, anon;
grant execute on function public.beleth_reactivate_account() to authenticated;

-- ── 4. delete ──────────────────────────────────────────────────────────────
-- Removes the caller's auth.users row. Every user-owned table cascades from
-- there. Owned by the migration runner (postgres), which may delete from the
-- auth schema; a normal caller cannot. Refuses the master-admin account.
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

-- ── 5. reload PostgREST schema cache ───────────────────────────────────────
notify pgrst, 'reload schema';
