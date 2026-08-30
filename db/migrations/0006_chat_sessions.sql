-- 0006_chat_sessions.sql — "Chat with Beleth": per-user conversation history.
--
-- Milestone 9 adds a conversational surface to the dashboard: a signed-in
-- visitor can ask Beleth about its strategy, its recent decisions and current
-- market conditions. Beleth answers in character, in English, and can ONLY
-- read — the tool layer it is given never writes anything (that guarantee is
-- enforced in the webapp, app/lib/chat/tools.ts, not here).
--
-- This is the webapp's first PER-USER write path. 0005 (the kill switch) added
-- a write path too, but for a shared singleton column, so it went through a
-- SECURITY DEFINER function. Here the data is naturally owned by one user, so
-- plain owner-scoped RLS policies are the clean fit: a user reads and writes
-- exactly their own sessions and messages, nothing else. Any authenticated
-- role qualifies (public_user and up) — the chat is offered to every signed-in
-- account, not just the backoffice.
--
-- The agent (service role) never touches these tables; it bypasses RLS anyway.
-- anon has no policy and therefore no access.
--
-- Idempotent: safe to re-run. Applied by hand: Supabase dashboard -> SQL
-- Editor -> paste -> Run.

-- ── 1. sessions ─────────────────────────────────────────────────────────────
create table if not exists public.chat_sessions (
    id         uuid        primary key default gen_random_uuid(),
    user_id    uuid        not null references auth.users (id) on delete cascade,
    title      text            null,          -- derived from the first user message
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()  -- bumped on every new turn; sidebar orders by this
);

create index if not exists idx_chat_sessions_user_updated
    on public.chat_sessions (user_id, updated_at desc);

create trigger trg_chat_sessions_touch_updated_at
    before update on public.chat_sessions
    for each row execute function public.beleth_touch_updated_at();

-- ── 2. messages ────────────────────────────────────────────────────────────
-- One row per message in the OpenAI-style transcript. `tool_calls` is the
-- assistant's requested calls (jsonb array); `tool_call_id` links a role='tool'
-- result back to the call that produced it. `content` is '' for an assistant
-- turn that only emitted tool calls. `model` / `usage` are stamped on the
-- final assistant row for cost visibility.
create table if not exists public.chat_messages (
    id           uuid        primary key default gen_random_uuid(),
    session_id   uuid        not null references public.chat_sessions (id) on delete cascade,
    role         text        not null check (role in ('user', 'assistant', 'tool')),
    content      text        not null default '',
    tool_calls   jsonb           null,
    tool_call_id text            null,
    model        text            null,
    usage        jsonb           null,
    created_at   timestamptz not null default now()
);

create index if not exists idx_chat_messages_session
    on public.chat_messages (session_id, created_at);

-- ── 3. row level security ──────────────────────────────────────────────────
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

-- A user fully owns their own sessions (select / insert / update / delete).
drop policy if exists "own chat sessions" on public.chat_sessions;
create policy "own chat sessions"
    on public.chat_sessions
    for all
    to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

-- A message is reachable only through a session the same user owns.
drop policy if exists "own chat messages" on public.chat_messages;
create policy "own chat messages"
    on public.chat_messages
    for all
    to authenticated
    using (
        exists (
            select 1 from public.chat_sessions s
            where s.id = session_id and s.user_id = (select auth.uid())
        )
    )
    with check (
        exists (
            select 1 from public.chat_sessions s
            where s.id = session_id and s.user_id = (select auth.uid())
        )
    );
