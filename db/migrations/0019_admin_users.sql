-- 0019_admin_users.sql — the master-admin "Users" panel.
--
-- The webapp so far can read only the caller's own public.profiles row (0004)
-- and can write nothing but agent_status.paused (0005) and the caller's own
-- profile fields (0014). This migration adds the last operator surface from
-- the spec §6: master_admin manages the user list.
--
-- Same invariant as every other write path here: no INSERT/UPDATE/DELETE policy
-- is added to any table. Three SECURITY DEFINER functions are the only writers,
-- and each re-checks `beleth_role() = 'master_admin'` in its own body — the
-- webapp still has no service-role client.
--
--   beleth_admin_list_users()            — the roster (profile + auth.users +
--                                          activity tallies), master_admin only.
--   beleth_admin_set_role(uid, role)     — promote / demote, with a guard that
--                                          a master_admin cannot strip its own
--                                          rights and the last master_admin
--                                          cannot be demoted.
--   beleth_admin_delete_user(uid)        — delete the auth.users row; every
--                                          user-owned table is ON DELETE
--                                          CASCADE so profiles / forum / chat /
--                                          progress go with it. Refuses self
--                                          and refuses a master_admin target.
--   beleth_admin_confirm_email(uid)      — force email_confirmed_at for a user
--                                          stuck before confirmation. This is a
--                                          local confirm, NOT a re-send — the
--                                          webapp cannot reach the GoTrue admin
--                                          API without the service-role key.
--
-- Every mutating call is appended to public.admin_user_events (append-only from
-- SQL: no write policy, the functions are the only writers). Readable by
-- master_admin only — unlike the kill-switch log this carries emails and roles.
--
-- Idempotent: safe to re-run.

-- ── 1. audit trail ──────────────────────────────────────────────────────────
create table if not exists public.admin_user_events (
    id           uuid        primary key default gen_random_uuid(),
    actor        uuid            null references auth.users (id) on delete set null,
    actor_email  text            null,
    target       uuid            null references auth.users (id) on delete set null,
    target_email text            null,
    action       text        not null check (action in ('role_change', 'delete', 'confirm_email')),
    detail       jsonb       not null default '{}'::jsonb,
    created_at   timestamptz not null default now()
);

create index if not exists idx_admin_user_events_created_at
    on public.admin_user_events (created_at desc);

alter table public.admin_user_events enable row level security;

drop policy if exists "master_admin reads user events" on public.admin_user_events;
create policy "master_admin reads user events"
    on public.admin_user_events
    for select
    to authenticated
    using (public.beleth_role() = 'master_admin');

-- ── 2. roster ──────────────────────────────────────────────────────────────
-- One row per profile, joined to auth.users for the confirmation / sign-in
-- timestamps and to the activity tables for the tallies shown in the panel.
-- XP and streak come straight from user_progress; the level/title ladder is
-- derived in the webapp (src/lib/progress.ts), so only the raw counters ship.
create or replace function public.beleth_admin_list_users()
returns table (
    user_id            uuid,
    email              text,
    role               text,
    display_name       text,
    avatar_url         text,
    bio                text,
    created_at         timestamptz,
    last_sign_in_at    timestamptz,
    email_confirmed_at timestamptz,
    forum_topic_count  bigint,
    forum_post_count   bigint,
    chat_session_count bigint,
    xp                 integer,
    streak_days        integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.beleth_role() <> 'master_admin' then
    raise exception 'only master_admin may list users' using errcode = '42501';
  end if;

  return query
  select
    p.user_id,
    coalesce(u.email, p.email)                        as email,
    p.role,
    p.display_name,
    p.avatar_url,
    p.bio,
    p.created_at,
    u.last_sign_in_at,
    u.email_confirmed_at,
    coalesce(ft.n, 0)                                 as forum_topic_count,
    coalesce(fp.n, 0)                                 as forum_post_count,
    coalesce(cs.n, 0)                                 as chat_session_count,
    coalesce(up.xp, 0)                                as xp,
    coalesce(up.streak_days, 0)                       as streak_days
  from public.profiles p
  left join auth.users u on u.id = p.user_id
  left join (select author_id, count(*) n from public.forum_topics group by author_id) ft
         on ft.author_id = p.user_id
  left join (select author_id, count(*) n from public.forum_posts group by author_id) fp
         on fp.author_id = p.user_id
  left join (select user_id, count(*) n from public.chat_sessions group by user_id) cs
         on cs.user_id = p.user_id
  left join public.user_progress up on up.user_id = p.user_id
  order by p.created_at desc;
end;
$$;

revoke all on function public.beleth_admin_list_users() from public, anon;
grant execute on function public.beleth_admin_list_users() to authenticated;

-- ── 3. set role ────────────────────────────────────────────────────────────
-- Guards, in order: caller is master_admin; role value is valid; the caller is
-- not demoting itself; the last remaining master_admin is not being demoted.
-- A no-op (same role) returns the row without logging.
create or replace function public.beleth_admin_set_role(
    p_user_id uuid,
    p_role    text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_old    text;
  v_row    public.profiles;
  v_masters int;
begin
  if public.beleth_role() <> 'master_admin' then
    raise exception 'only master_admin may change roles' using errcode = '42501';
  end if;
  if p_role not in ('public_user', 'demo_admin', 'master_admin') then
    raise exception 'invalid role %', p_role using errcode = '22023';
  end if;

  select role into v_old from public.profiles where user_id = p_user_id;
  if not found then
    raise exception 'no profile for %', p_user_id using errcode = 'P0002';
  end if;

  if v_old = p_role then
    select * into v_row from public.profiles where user_id = p_user_id;
    return v_row;
  end if;

  if p_user_id = v_uid and p_role <> 'master_admin' then
    raise exception 'a master_admin cannot demote itself' using errcode = '42501';
  end if;

  if v_old = 'master_admin' and p_role <> 'master_admin' then
    select count(*) into v_masters from public.profiles where role = 'master_admin';
    if v_masters <= 1 then
      raise exception 'cannot demote the last master_admin' using errcode = '42501';
    end if;
  end if;

  update public.profiles
     set role = p_role
   where user_id = p_user_id
  returning * into v_row;

  insert into public.admin_user_events (actor, actor_email, target, target_email, action, detail)
  values (
    v_uid,
    (select email from auth.users where id = v_uid),
    p_user_id,
    (select email from auth.users where id = p_user_id),
    'role_change',
    jsonb_build_object('from', v_old, 'to', p_role)
  );

  return v_row;
end;
$$;

revoke all on function public.beleth_admin_set_role(uuid, text) from public, anon;
grant execute on function public.beleth_admin_set_role(uuid, text) to authenticated;

-- ── 4. delete user ─────────────────────────────────────────────────────────
-- Deletes the auth.users row; public.profiles, forum_topics, forum_posts,
-- chat_sessions and user_progress all reference it ON DELETE CASCADE, so the
-- user's data goes with it. The event is written first so the audit row
-- survives the cascade (its target FK is ON DELETE SET NULL).
create or replace function public.beleth_admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_role  text;
  v_email text;
begin
  if public.beleth_role() <> 'master_admin' then
    raise exception 'only master_admin may delete users' using errcode = '42501';
  end if;
  if p_user_id = v_uid then
    raise exception 'cannot delete your own account' using errcode = '42501';
  end if;

  select role, email into v_role, v_email
    from public.profiles p
    left join auth.users u on u.id = p.user_id
   where p.user_id = p_user_id;
  if not found then
    raise exception 'no profile for %', p_user_id using errcode = 'P0002';
  end if;
  if v_role = 'master_admin' then
    raise exception 'demote the master_admin before deleting it' using errcode = '42501';
  end if;

  insert into public.admin_user_events (actor, actor_email, target, target_email, action)
  values (
    v_uid,
    (select email from auth.users where id = v_uid),
    p_user_id,
    v_email,
    'delete'
  );

  delete from auth.users where id = p_user_id;
end;
$$;

revoke all on function public.beleth_admin_delete_user(uuid) from public, anon;
grant execute on function public.beleth_admin_delete_user(uuid) to authenticated;

-- ── 5. force email confirmation ────────────────────────────────────────────
-- For a user stuck before confirmation. Local only: it stamps
-- email_confirmed_at, it does NOT send a fresh confirmation mail (that needs
-- the GoTrue admin API, which the webapp cannot reach). A no-op when already
-- confirmed.
create or replace function public.beleth_admin_confirm_email(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_was  timestamptz;
begin
  if public.beleth_role() <> 'master_admin' then
    raise exception 'only master_admin may confirm emails' using errcode = '42501';
  end if;

  select email_confirmed_at into v_was from auth.users where id = p_user_id;
  if not found then
    raise exception 'no user %', p_user_id using errcode = 'P0002';
  end if;
  if v_was is not null then
    return;
  end if;

  update auth.users set email_confirmed_at = now() where id = p_user_id;

  insert into public.admin_user_events (actor, actor_email, target, target_email, action)
  values (
    v_uid,
    (select email from auth.users where id = v_uid),
    p_user_id,
    (select email from auth.users where id = p_user_id),
    'confirm_email'
  );
end;
$$;

revoke all on function public.beleth_admin_confirm_email(uuid) from public, anon;
grant execute on function public.beleth_admin_confirm_email(uuid) to authenticated;
