-- 0029_demo_readonly_enforcement.sql — make the demo account genuinely read-only.
--
-- The demo_admin account is the shared login handed to contest judges, and the public
-- homepage signs anyone into it with one click. It must therefore be treated as a public
-- role: whatever it can write, anyone on the internet can write.
--
-- 0025 declared demo_admin read-only but only ever enforced it in four functions
-- (beleth_update_profile, beleth_set_avatar_url, beleth_deactivate_account,
-- beleth_delete_account). Everything else was open. A demo session could create, edit and
-- delete forum topics and posts, upload 5 MB images, write chat transcripts, accrue XP and
-- reactivate a deactivated account. Because the login is *shared*, author_id = auth.uid()
-- is not a boundary between one judge and the next: beleth_forum_delete_topic cascades to
-- every reply in the thread, so one visitor could delete another's conversation.
--
-- Three layers, because no single one covers every path:
--
--   1. RLS policies — the first refusal, for writes that go through the anon client.
--   2. Row triggers — the backstop. SECURITY DEFINER functions run as the table owner and
--      bypass RLS entirely, so policies alone cannot stop them. profiles and user_progress
--      have no write policies at all and are reachable *only* that way. A trigger sits below
--      every code path, including ones written after this migration.
--   3. Bookkeeping functions — see below.
--
-- The bookkeeping RPCs (daily-login XP, chat XP, forum view counter) fire on ordinary page
-- loads, not on a user's intent to write. Raising there would log an error every time a
-- judge opens the dashboard, for a counter nobody reads. They become a silent no-op for
-- demo_admin instead, still returning the current row so the sidebar level chip renders.

-- ── 1. the guard trigger ───────────────────────────────────────────────────────────────

create or replace function public.beleth_block_demo_writes()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.beleth_role() = 'demo_admin' then
    raise exception 'the demo account is read-only'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.beleth_block_demo_writes() is
  'Refuses any write made by a demo_admin session. Attached to every table the shared '
  'judges'' account can reach, including those written only through SECURITY DEFINER '
  'functions, which bypass RLS.';

-- The agent is unaffected: it writes with the service-role key, where auth.uid() is null,
-- so beleth_role() returns 'public_user'. A master_admin acting on demo-authored content is
-- likewise unaffected — the trigger reads the caller's role, not the row's author.

drop trigger if exists trg_forum_topics_block_demo  on public.forum_topics;
drop trigger if exists trg_forum_posts_block_demo   on public.forum_posts;
drop trigger if exists trg_chat_sessions_block_demo on public.chat_sessions;
drop trigger if exists trg_chat_messages_block_demo on public.chat_messages;
drop trigger if exists trg_profiles_block_demo      on public.profiles;
drop trigger if exists trg_user_progress_block_demo on public.user_progress;

create trigger trg_forum_topics_block_demo
  before insert or update or delete on public.forum_topics
  for each row execute function public.beleth_block_demo_writes();

create trigger trg_forum_posts_block_demo
  before insert or update or delete on public.forum_posts
  for each row execute function public.beleth_block_demo_writes();

create trigger trg_chat_sessions_block_demo
  before insert or update or delete on public.chat_sessions
  for each row execute function public.beleth_block_demo_writes();

create trigger trg_chat_messages_block_demo
  before insert or update or delete on public.chat_messages
  for each row execute function public.beleth_block_demo_writes();

create trigger trg_profiles_block_demo
  before insert or update or delete on public.profiles
  for each row execute function public.beleth_block_demo_writes();

create trigger trg_user_progress_block_demo
  before insert or update or delete on public.user_progress
  for each row execute function public.beleth_block_demo_writes();

-- ── 2. RLS policies — refuse before the trigger has to ─────────────────────────────────

drop policy if exists "authenticated create forum topics" on public.forum_topics;
create policy "authenticated create forum topics"
  on public.forum_topics for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.beleth_role() <> 'demo_admin'
  );

drop policy if exists "authenticated create forum posts" on public.forum_posts;
create policy "authenticated create forum posts"
  on public.forum_posts for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.beleth_role() <> 'demo_admin'
    and exists (
      select 1 from public.forum_topics t
       where t.id = forum_posts.topic_id
         and t.closed = false
    )
  );

-- chat_sessions / chat_messages were FOR ALL, which granted INSERT/UPDATE/DELETE alongside
-- SELECT. Split them: reading your own transcript stays open to every signed-in account
-- (demo included, so a judge can still read the conversation), writing does not.

drop policy if exists "own chat sessions" on public.chat_sessions;
create policy "read own chat sessions"
  on public.chat_sessions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "write own chat sessions"
  on public.chat_sessions for all to authenticated
  using (user_id = (select auth.uid()) and public.beleth_role() <> 'demo_admin')
  with check (user_id = (select auth.uid()) and public.beleth_role() <> 'demo_admin');

drop policy if exists "own chat messages" on public.chat_messages;
create policy "read own chat messages"
  on public.chat_messages for select to authenticated
  using (
    exists (
      select 1 from public.chat_sessions s
       where s.id = chat_messages.session_id
         and s.user_id = (select auth.uid())
    )
  );
create policy "write own chat messages"
  on public.chat_messages for all to authenticated
  using (
    public.beleth_role() <> 'demo_admin'
    and exists (
      select 1 from public.chat_sessions s
       where s.id = chat_messages.session_id
         and s.user_id = (select auth.uid())
    )
  )
  with check (
    public.beleth_role() <> 'demo_admin'
    and exists (
      select 1 from public.chat_sessions s
       where s.id = chat_messages.session_id
         and s.user_id = (select auth.uid())
    )
  );

-- ── 3. storage — the demo account uploads nothing ──────────────────────────────────────
-- Both buckets are public, so their SELECT policies are decorative; only the write
-- policies matter. forum-media has no UPDATE policy, which is a separate inconsistency
-- left untouched here.

drop policy if exists "avatars owner insert" on storage.objects;
create policy "avatars owner insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.beleth_role() <> 'demo_admin'
  );

drop policy if exists "avatars owner update" on storage.objects;
create policy "avatars owner update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.beleth_role() <> 'demo_admin'
  );

drop policy if exists "avatars owner delete" on storage.objects;
create policy "avatars owner delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.beleth_role() <> 'demo_admin'
  );

drop policy if exists "forum media owner upload" on storage.objects;
create policy "forum media owner upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'forum-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.beleth_role() <> 'demo_admin'
  );

drop policy if exists "forum media owner delete" on storage.objects;
create policy "forum media owner delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'forum-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.beleth_role() <> 'demo_admin'
  );

-- ── 4. content mutations — refuse in the function too ──────────────────────────────────
-- These already carry their own ownership checks; the demo guard is added at the top so
-- the caller gets 'the demo account is read-only' rather than a trigger message.

create or replace function public.beleth_reactivate_account()
returns profiles
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_row  public.profiles;
begin
  if v_uid is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;
  perform public.beleth_assert_not_demo();

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

-- ── 5. bookkeeping — a silent no-op for demo, not an exception ──────────────────────────
-- Each of these starts with an `insert … on conflict do nothing`, so even the "nothing to
-- do today" path writes. The demo branch returns the existing row without touching it.

create or replace function public.beleth_touch_daily_login()
returns user_progress
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_today date := (now() at time zone 'utc')::date;
  v_base  int  := 10;
  v_bonus int;
  v_row   public.user_progress;
begin
  if v_uid is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;

  if public.beleth_role() = 'demo_admin' then
    select * into v_row from public.user_progress where user_id = v_uid;
    return v_row;                       -- read-only account: never accrues, never writes
  end if;

  insert into public.user_progress (user_id) values (v_uid)
    on conflict (user_id) do nothing;
  select * into v_row from public.user_progress where user_id = v_uid for update;

  if v_row.last_login_on = v_today then
    return v_row;                       -- already counted today
  end if;

  if v_row.last_login_on = v_today - 1 then
    v_row.streak_days := v_row.streak_days + 1;
  else
    v_row.streak_days := 1;             -- streak broken (or first ever)
  end if;

  v_bonus := least(v_row.streak_days, 7) * 2;   -- caps at +14/day

  update public.user_progress
     set xp            = xp + v_base + v_bonus,
         streak_days   = v_row.streak_days,
         last_login_on = v_today
   where user_id = v_uid
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.beleth_award_chat_xp()
returns user_progress
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_today  date := (now() at time zone 'utc')::date;
  v_msg_xp int  := 3;
  v_cap    int  := 10;
  v_count  int;
  v_row    public.user_progress;
begin
  if v_uid is null then
    raise exception 'must be signed in' using errcode = '42501';
  end if;

  if public.beleth_role() = 'demo_admin' then
    select * into v_row from public.user_progress where user_id = v_uid;
    return v_row;                       -- read-only account: never accrues, never writes
  end if;

  insert into public.user_progress (user_id) values (v_uid)
    on conflict (user_id) do nothing;
  select * into v_row from public.user_progress where user_id = v_uid for update;

  v_count := case when v_row.chat_xp_on is distinct from v_today
                  then 0 else v_row.chat_msgs_today end;

  if v_count >= v_cap then
    update public.user_progress
       set chat_xp_on = v_today, chat_msgs_today = v_count
     where user_id = v_uid
    returning * into v_row;
    return v_row;
  end if;

  update public.user_progress
     set xp              = xp + v_msg_xp,
         chat_xp_on      = v_today,
         chat_msgs_today = v_count + 1
   where user_id = v_uid
  returning * into v_row;

  return v_row;
end;
$$;

-- The view counter is fired from a client component on every topic mount. For demo it does
-- nothing. (That this function is also callable by anon with no check at all is a separate
-- problem — an unrated anonymous write primitive — not addressed here.)
create or replace function public.beleth_forum_bump_view(p_topic_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.beleth_role() = 'demo_admin' then
    return;
  end if;

  update public.forum_topics
     set view_count = view_count + 1
   where id = p_topic_id;
end;
$$;
