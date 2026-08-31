-- 0024_forum_author_avatars.sql — batch avatar lookup for forum author discs.
--
-- The forum denormalises `author_name` onto every topic and post (0008), but not
-- the author's avatar, so the forum author disc could only ever show initials —
-- an uploaded avatar was invisible everywhere in the forum. `beleth_public_profile`
-- (0023) already exposes a safe public subset of one profile; this adds the
-- set-returning variant the forum needs: given the distinct author ids on a
-- page, return each one's display name and avatar URL in a single round trip.
--
-- SECURITY DEFINER so it sees any profile row regardless of the caller's RLS
-- view, but it returns only the two already-public columns (the same ones
-- `beleth_public_profile` exposes) — never the email or role. RLS on `profiles`
-- stays "own row only".
--
-- Idempotent: safe to re-run.

create or replace function public.beleth_public_avatars(p_user_ids uuid[])
returns table (
  user_id      uuid,
  display_name text,
  avatar_url   text
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
    )            as display_name,
    p.avatar_url
  from public.profiles p
  where p.user_id = any(coalesce(p_user_ids, array[]::uuid[]));
$$;

revoke all on function public.beleth_public_avatars(uuid[]) from public;
grant execute on function public.beleth_public_avatars(uuid[]) to anon, authenticated;
