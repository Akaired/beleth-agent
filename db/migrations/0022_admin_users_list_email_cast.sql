-- 0022_admin_users_list_email_cast.sql — cast auth.users.email to text.
--
-- auth.users.email is `character varying`; beleth_admin_list_users() declares
-- its `email` output column as `text`, so the call failed with
--   42804: structure of query does not match function result type
--         (Returned type character varying does not match expected type text
--          in column 2)
--
-- Fix: `coalesce(u.email, p.email)::text`. Body otherwise identical to 0021.
--
-- Idempotent: safe to re-run.

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
  if public.beleth_role() <> 'master_admin' then
    raise exception 'only master_admin may list users' using errcode = '42501';
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
