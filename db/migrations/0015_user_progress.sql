-- 0015_user_progress.sql — a light gamification layer for signed-in users.
--
-- Every user accrues "experience" (XP) from two habits:
--   * showing up      — the first dashboard load of a UTC day grants a base
--                       award plus a streak bonus (consecutive days).
--   * talking to Beleth — each chat message grants a small award, capped at a
--                        handful per day so it cannot be farmed.
--
-- XP maps to a level and an esoteric title (Neophyte … Oracle of Beleth); the
-- ladder itself lives in the webapp (src/lib/progress.ts) so it can be tuned
-- without a migration. This table only stores the raw counters.
--
-- Same invariant as profiles: an authenticated user READs their own row; the
-- only writers are the two SECURITY DEFINER RPCs below and the service role.
--
-- Idempotent: safe to re-run.

-- ── 1. table ────────────────────────────────────────────────────────────────
create table if not exists public.user_progress (
    user_id         uuid        primary key references auth.users (id) on delete cascade,
    xp              integer     not null default 0  check (xp >= 0),
    streak_days     integer     not null default 0  check (streak_days >= 0),
    last_login_on   date            null,
    chat_xp_on      date            null,
    chat_msgs_today integer     not null default 0  check (chat_msgs_today >= 0),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

drop trigger if exists trg_user_progress_touch_updated_at on public.user_progress;
create trigger trg_user_progress_touch_updated_at
    before update on public.user_progress
    for each row execute function public.beleth_touch_updated_at();

alter table public.user_progress enable row level security;

drop policy if exists "users read own progress" on public.user_progress;
create policy "users read own progress"
    on public.user_progress
    for select
    to authenticated
    using (user_id = (select auth.uid()));

-- ── 2. daily-login award ───────────────────────────────────────────────────
-- Idempotent within a UTC day: safe to call on every dashboard load. Returns
-- the progress row (fresh or unchanged).
create or replace function public.beleth_touch_daily_login()
returns public.user_progress
language plpgsql
security definer
set search_path = public
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

revoke all on function public.beleth_touch_daily_login() from public, anon;
grant execute on function public.beleth_touch_daily_login() to authenticated;

-- ── 3. chat-message award ─────────────────────────────────────────────────
-- +3 XP per message, at most 10 counted messages per UTC day. Call once per
-- persisted user message; over the cap it is a no-op that still returns the row.
create or replace function public.beleth_award_chat_xp()
returns public.user_progress
language plpgsql
security definer
set search_path = public
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

revoke all on function public.beleth_award_chat_xp() from public, anon;
grant execute on function public.beleth_award_chat_xp() to authenticated;

-- ── 4. provision on signup + backfill ─────────────────────────────────────
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

  insert into public.user_progress (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

insert into public.user_progress (user_id)
select id from auth.users
on conflict (user_id) do nothing;
