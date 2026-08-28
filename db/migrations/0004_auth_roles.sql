-- 0004_auth_roles.sql — authenticated-user roles for the webapp dashboard.
--
-- Phase 2 of the webapp introduces Supabase Auth (email + password for now;
-- magic link + Resend later). Every signed-up user gets a row in
-- public.profiles with a role. The three roles map 1:1 onto the spec §6:
--
--   public_user   — self-signup; a curated logged-in dashboard.
--   demo_admin    — the shared account Davide hands to judges; the whole
--                   backoffice, READ ONLY (decision history, raw LLM
--                   reasoning, full risk-check detail, strategy config).
--   master_admin  — Davide only; everything above plus operational control
--                   (pause the agent, edit config). Write paths land in a
--                   later migration — this file only establishes the role.
--
-- Role assignment is deliberately out-of-band: a new user is always
-- 'public_user'. Promotion to demo_admin / master_admin is a manual UPDATE
-- run with the service role (or the Management API), never something the
-- webapp can do. There is no RLS policy that lets an authenticated user
-- change their own role.
--
-- Idempotent: safe to re-run.

-- ── 1. profiles ──────────────────────────────────────────────────────────────
create table if not exists public.profiles (
    user_id    uuid        primary key references auth.users (id) on delete cascade,
    email      text            null,
    role       text        not null default 'public_user'
                            check (role in ('public_user', 'demo_admin', 'master_admin')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create trigger trg_profiles_touch_updated_at
    before update on public.profiles
    for each row execute function public.beleth_touch_updated_at();

alter table public.profiles enable row level security;

-- A signed-in user may read exactly their own profile row (the app needs the
-- role to decide what to render). No INSERT/UPDATE/DELETE policy exists, so
-- authenticated users cannot create or mutate profile rows at all — the
-- trigger below (SECURITY DEFINER) is the only writer, plus the service role.
drop policy if exists "users read own profile" on public.profiles;
create policy "users read own profile"
    on public.profiles
    for select
    to authenticated
    using (user_id = (select auth.uid()));

-- ── 2. auto-provision a profile on signup ────────────────────────────────────
create or replace function public.beleth_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created
    after insert on auth.users
    for each row execute function public.beleth_handle_new_user();

-- ── 3. role helper for RLS / server code ─────────────────────────────────────
-- SECURITY DEFINER so it can read public.profiles regardless of the caller's
-- own RLS view. STABLE: one value per statement. Returns 'public_user' for any
-- caller without a profile row (anon, or a race before the signup trigger).
create or replace function public.beleth_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where user_id = (select auth.uid())),
    'public_user'
  );
$$;

-- ── 4. backfill any users that predate the trigger ──────────────────────────
insert into public.profiles (user_id, email)
select id, email from auth.users
on conflict (user_id) do nothing;
