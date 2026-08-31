-- 0026_demo_admin_backoffice_reads.sql — let demo_admin READ the whole backoffice.
--
-- The demo_admin account (the single read-only login handed to the judges) is
-- meant to see every part of the backoffice — decisions, risk checks, agent
-- logs, the operator controls, the user roster, the documentation drafts — and
-- touch nothing. The webapp already blocks every write for demo_admin at the
-- server-action layer AND every mutating SECURITY DEFINER function re-checks
-- `beleth_role() = 'master_admin'` in its own body, so opening the *reads* here
-- does not open any write path.
--
-- This migration relaxes the three read-only SECURITY DEFINER readers that were
-- master_admin-only from `<> 'master_admin'` to `not in ('demo_admin',
-- 'master_admin')`:
--
--   beleth_admin_list_users()   — the user roster (0019 / 0021 / 0022)
--   beleth_docs_admin_list()    — every doc page incl. drafts (0016)
--   beleth_docs_admin_get(uuid) — one doc page incl. drafts (0016)
--
-- Untouched (stay master_admin only): beleth_admin_set_role /
-- beleth_admin_delete_user / beleth_admin_confirm_email, every
-- beleth_docs_* write, beleth_set_agent_paused, and the beleth_docs_assert_admin
-- guard the doc writes call. admin_user_events (role-change audit, carries
-- emails) keeps its master_admin-only SELECT policy.
--
-- Idempotent: safe to re-run. Bodies are copied verbatim from the latest prior
-- migration for each function, with only the role check widened + a new
-- beleth_docs_assert_reader() helper for the two doc readers.

-- ── 1. user roster — demo_admin may read ───────────────────────────────────
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
begin
  if public.beleth_role() not in ('demo_admin', 'master_admin') then
    raise exception 'only demo_admin or master_admin may list users'
      using errcode = '42501';
  end if;

  return query
  select
    p.user_id,
    coalesce(u.email, p.email)::text                  as email,
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

-- ── 2. documentation readers — demo_admin may read (drafts included) ───────
create or replace function public.beleth_docs_assert_reader()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.beleth_role() not in ('demo_admin', 'master_admin') then
    raise exception 'only demo_admin or master_admin may read draft documentation'
      using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.beleth_docs_assert_reader() from public, anon;
grant execute on function public.beleth_docs_assert_reader() to authenticated;

create or replace function public.beleth_docs_admin_list()
returns setof public.docs_pages
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.beleth_docs_assert_reader();
  return query
    select * from public.docs_pages
     order by category asc, order_index asc, created_at asc;
end;
$$;

create or replace function public.beleth_docs_admin_get(p_id uuid)
returns public.docs_pages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.docs_pages;
begin
  perform public.beleth_docs_assert_reader();
  select * into v_row from public.docs_pages where id = p_id;
  if not found then
    raise exception 'page % not found', p_id using errcode = 'P0002';
  end if;
  return v_row;
end;
$$;

revoke all on function public.beleth_docs_admin_list() from public, anon;
revoke all on function public.beleth_docs_admin_get(uuid) from public, anon;
grant execute on function public.beleth_docs_admin_list() to authenticated;
grant execute on function public.beleth_docs_admin_get(uuid) to authenticated;
