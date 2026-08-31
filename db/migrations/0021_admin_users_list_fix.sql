-- 0021_admin_users_list_fix.sql — fix ambiguous column in beleth_admin_list_users().
--
-- 0019 declared the function with RETURNS TABLE (user_id uuid, email text,
-- role text, ...). Those output columns are also PL/pgSQL variables, so the
-- unqualified `user_id` inside the chat_sessions sub-select collided with the
-- output variable and the whole call failed with
--   42702: column reference "user_id" is ambiguous
--
-- Fix: `#variable_conflict use_column` (any ambiguous name resolves to the
-- column — the body never reads the OUT variables, it only RETURN QUERYs), plus
-- an explicit alias on the sub-select for good measure. Body is otherwise
-- identical to 0019.
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
