-- 0030_demo_may_post_not_destroy.sql — narrow 0029 from "no writes" to "no destruction".
--
-- 0029 made the shared demo_admin account fully read-only. That is safe but it also took
-- away the two things the account exists to show: writing on the forum (under the per-post
-- "(demo)" alias the composer already asks for) and talking to Beleth in the chat. Both are
-- product surfaces a judge is meant to try.
--
-- The line moves here. The danger with a *shared* public login was never the writing: it is
-- that author_id = auth.uid() makes every visitor the owner of every other visitor's
-- content, so an edit or a delete reaches someone else's words — and deleting a topic
-- cascades to the whole thread (0009). Creating content has no such reach.
--
-- So demo_admin may INSERT forum topics, forum posts, chat sessions and chat messages, and
-- may NOT update or delete any of them. profiles and user_progress stay closed exactly as
-- 0029 left them, as do the avatars and forum-media storage buckets: an upload from a
-- public login is an anonymous 5 MB write to a public bucket, which no product surface
-- needs. The chat's per-visitor message allowance is enforced in the webapp, not here —
-- it is a product limit on a browser, not a security boundary.
--
-- Layering, unchanged in spirit from 0029: RLS carries ownership, triggers carry the demo
-- rule, because the SECURITY DEFINER functions (beleth_forum_edit_post,
-- beleth_forum_delete_post, beleth_forum_delete_topic) bypass RLS entirely.

-- ── 1. triggers: block the destructive verbs only ──────────────────────────────────────
--
-- Scope matters. A blanket BEFORE UPDATE trigger on forum_topics would fire on
-- beleth_forum_after_post_insert (0008:196), which bumps reply_count and last_posted_at in
-- the *caller's* transaction — a demo reply would refuse itself. forum_topics therefore
-- guards DELETE only; nothing else lets a demo session change a topic row (bump_view is
-- already a no-op for demo, and pin/close are master-only).

drop trigger if exists trg_forum_topics_block_demo  on public.forum_topics;
drop trigger if exists trg_forum_posts_block_demo   on public.forum_posts;
drop trigger if exists trg_chat_sessions_block_demo on public.chat_sessions;
drop trigger if exists trg_chat_messages_block_demo on public.chat_messages;

-- Topics: deleting one cascades to every reply in the thread — the worst reach a shared
-- login has. Inserts arrive through beleth_forum_create_topic and stay allowed.
create trigger trg_forum_topics_block_demo
  before delete on public.forum_topics
  for each row execute function public.beleth_block_demo_writes();

-- Posts: no edit, no delete. Editing another visitor's post to an empty body would be a
-- deletion by another name, which is why UPDATE is here and not left open.
create trigger trg_forum_posts_block_demo
  before update or delete on public.forum_posts
  for each row execute function public.beleth_block_demo_writes();

-- Chat sessions: created and touched (updated_at) on every turn, so INSERT and UPDATE must
-- pass. Deleting a transcript from a shared login discards another visitor's conversation.
create trigger trg_chat_sessions_block_demo
  before delete on public.chat_sessions
  for each row execute function public.beleth_block_demo_writes();

-- Chat messages: written per turn. UPDATE is the thumbs rating and DELETE is the
-- edit-and-regenerate path; both reach into a transcript the caller may not own.
create trigger trg_chat_messages_block_demo
  before update or delete on public.chat_messages
  for each row execute function public.beleth_block_demo_writes();

-- profiles and user_progress keep their 0029 triggers on all three verbs: identity and XP
-- belong to a person, and the demo login is not one.

-- ── 2. RLS: back to plain ownership ────────────────────────────────────────────────────

drop policy if exists "authenticated create forum topics" on public.forum_topics;
create policy "authenticated create forum topics"
  on public.forum_topics for insert to authenticated
  with check (author_id = (select auth.uid()));

drop policy if exists "authenticated create forum posts" on public.forum_posts;
create policy "authenticated create forum posts"
  on public.forum_posts for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and exists (
      select 1 from public.forum_topics t
       where t.id = forum_posts.topic_id
         and t.closed = false
    )
  );

-- 0029 split these in two to keep reading open while writing was shut. With writing open
-- again the split has no purpose: restore the single ownership policy from 0006.
drop policy if exists "read own chat sessions"  on public.chat_sessions;
drop policy if exists "write own chat sessions" on public.chat_sessions;
drop policy if exists "own chat sessions"       on public.chat_sessions;
create policy "own chat sessions"
  on public.chat_sessions for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "read own chat messages"  on public.chat_messages;
drop policy if exists "write own chat messages" on public.chat_messages;
drop policy if exists "own chat messages"       on public.chat_messages;
create policy "own chat messages"
  on public.chat_messages for all to authenticated
  using (
    exists (
      select 1 from public.chat_sessions s
       where s.id = chat_messages.session_id
         and s.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.chat_sessions s
       where s.id = chat_messages.session_id
         and s.user_id = (select auth.uid())
    )
  );

-- ── 3. what does not change ────────────────────────────────────────────────────────────
-- beleth_reactivate_account still refuses demo (a shared login must not resurrect an
-- account); beleth_touch_daily_login and beleth_award_chat_xp stay silent no-ops, which is
-- now doubly right — demo chats, but XP is a personal counter and user_progress is closed;
-- beleth_forum_bump_view stays a no-op; every storage policy stays demo-free.

comment on function public.beleth_block_demo_writes() is
  'Refuses a write made by a demo_admin session. Attached to the verbs a shared public '
  'login must not reach: any write to profiles and user_progress, and updates/deletes of '
  'forum and chat content, which would otherwise let one visitor rewrite another''s.';
