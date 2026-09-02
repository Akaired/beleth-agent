-- 0031_backoffice_least_privilege.sql — narrow what the shared demo login can read,
-- and pin the last three unpinned search_paths.
--
-- The reperto this migration answers to: `demo_admin` is not a reserved role, it is a
-- PUBLIC one. `demoSignInAction` is an unauthenticated server action wired to two
-- buttons on the homepage, so anyone who clicks "Demo" holds a demo_admin session.
-- Everything demo can read is therefore public, and must be judged as public.
--
-- 1. `beleth_admin_list_users` returned every registered user's email address to
--    demo_admin (0026 widened the role check without narrowing the columns). 0019 had
--    already written down that `admin_user_events` stays master-only *because it
--    carries emails*; this restores the same rule to the roster. master_admin still
--    sees the address in full — the operator needs it to confirm an account.
--
-- 2. `beleth_role()` was executable by PUBLIC. The grants to anon and authenticated are
--    restated explicitly, so behaviour is identical and the privilege stops being
--    inherited by every future role.
--
-- 3. Three trigger functions ran with a mutable search_path. They are SECURITY INVOKER,
--    so the exposure is small, but an unqualified name in a trigger body is exactly the
--    shape the Supabase linter flags and there is no reason to leave it.
--
-- Reads restricted here are demo-visible ones only. Nothing anonymous changes, so this
-- can be applied ahead of a webapp deploy: the roster page is behind a session.
--
-- Idempotent: every statement is `create or replace` / `drop ... if exists`.

-- ── 1. mask the roster's email for the demo login ─────────────────────────────
-- Keeps the shape of an address (so the column still reads as an address) while
-- carrying no recoverable identity: first character, then a masked domain and its
-- public suffix.
create or replace function public.beleth_mask_email(p_email text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_email is null or position('@' in p_email) = 0 then null
    else left(split_part(p_email, '@', 1), 1) || '***@***.'
         || reverse(split_part(reverse(split_part(p_email, '@', 2)), '.', 1))
  end;
$$;

revoke all on function public.beleth_mask_email(text) from public, anon;
grant execute on function public.beleth_mask_email(text) to authenticated;

-- Body copied verbatim from 0026, with the email column masked for demo_admin.
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
#variable_conflict use_column
declare
  v_is_master boolean;
begin
  if public.beleth_role() not in ('demo_admin', 'master_admin') then
    raise exception 'only demo_admin or master_admin may list users'
      using errcode = '42501';
  end if;
  v_is_master := public.beleth_role() = 'master_admin';

  return query
  select
    p.user_id,
    case
      when v_is_master then coalesce(u.email, p.email)::text
      else public.beleth_mask_email(coalesce(u.email, p.email)::text)
    end                                               as email,
    p.role::text,
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
  left join (
    select ft2.author_id as uid, count(*) n
      from public.forum_topics ft2 group by ft2.author_id
  ) ft on ft.uid = p.user_id
  left join (
    select fp2.author_id as uid, count(*) n
      from public.forum_posts fp2 group by fp2.author_id
  ) fp on fp.uid = p.user_id
  left join (
    select cs2.user_id as uid, count(*) n
      from public.chat_sessions cs2 group by cs2.user_id
  ) cs on cs.uid = p.user_id
  left join public.user_progress up on up.user_id = p.user_id
  order by p.created_at desc;
end;
$$;

revoke all on function public.beleth_admin_list_users() from public, anon;
grant execute on function public.beleth_admin_list_users() to authenticated;

-- ── 2. beleth_role(): explicit grants instead of PUBLIC ───────────────────────
-- Both roles keep EXECUTE: RLS policies call this function as the invoking role.
revoke execute on function public.beleth_role() from public;
grant execute on function public.beleth_role() to anon, authenticated, service_role;

-- ── 3. pin the last three mutable search_paths ────────────────────────────────
-- Bodies unchanged; only `set search_path = public` is added.
create or replace function public.beleth_forum_set_post_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select coalesce(max(post_number), 0) + 1
    into new.post_number
    from public.forum_posts
   where topic_id = new.topic_id;
  return new;
end;
$$;

create or replace function public.beleth_preserve_first_seen_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.first_seen_at = coalesce(old.first_seen_at, new.first_seen_at);
  return new;
end;
$$;

create or replace function public.beleth_touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
