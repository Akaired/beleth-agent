/**
 * Server-side reads for the account page. RLS lets a signed-in user select
 * exactly their own `profiles` and `user_progress` rows, so the anon-key
 * server client is enough — no service role.
 */
import "server-only";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import type { AccountStatus } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/roles";
import type { ProgressRow } from "@/lib/progress";

export type AccountProfile = {
  userId: string;
  email: string | null;
  role: Role;
  status: AccountStatus;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: string | null;
  progress: ProgressRow;
};

/** The safe, public-facing view of any user's profile (see /u/[id]). */
export type PublicProfile = {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: string | null;
  xp: number;
  streakDays: number;
  isDeactivated: boolean;
};

const EMPTY_PROGRESS: ProgressRow = {
  xp: 0,
  streak_days: 0,
  last_login_on: null,
  chat_xp_on: null,
  chat_msgs_today: 0,
};

export async function fetchAccountProfile(): Promise<AccountProfile> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const supabase = await createClient();
  const [{ data: profile }, { data: progress }] = await Promise.all([
    supabase
      .from("profiles")
      .select("email, role, status, display_name, avatar_url, bio, created_at")
      .eq("user_id", ctx.userId)
      .maybeSingle(),
    supabase
      .from("user_progress")
      .select("xp, streak_days, last_login_on, chat_xp_on, chat_msgs_today")
      .eq("user_id", ctx.userId)
      .maybeSingle(),
  ]);

  return {
    userId: ctx.userId,
    email: (profile?.email as string | null) ?? ctx.email,
    role: (profile?.role as Role | undefined) ?? ctx.role,
    status:
      (profile?.status as AccountStatus | undefined) === "deactivated"
        ? "deactivated"
        : "active",
    displayName: (profile?.display_name as string | null) ?? null,
    avatarUrl: (profile?.avatar_url as string | null) ?? null,
    bio: (profile?.bio as string | null) ?? null,
    createdAt: (profile?.created_at as string | null) ?? null,
    progress: progress
      ? {
          xp: Number(progress.xp ?? 0),
          streak_days: Number(progress.streak_days ?? 0),
          last_login_on: (progress.last_login_on as string | null) ?? null,
          chat_xp_on: (progress.chat_xp_on as string | null) ?? null,
          chat_msgs_today: Number(progress.chat_msgs_today ?? 0),
        }
      : EMPTY_PROGRESS,
  };
}

/**
 * Any user's public profile, by id — the data behind /u/[id]. Goes through the
 * `beleth_public_profile` RPC (SECURITY DEFINER) which hand-picks a safe subset
 * of columns: nickname, avatar, bio, member-since, XP, streak. Never the email
 * or role. Returns null for an unknown id.
 */
export async function fetchPublicProfile(
  userId: string,
): Promise<PublicProfile | null> {
  if (!userId) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("beleth_public_profile", { p_user_id: userId })
    .maybeSingle();

  if (error || !data) return null;

  const row = data as {
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
    bio: string | null;
    created_at: string | null;
    xp: number | null;
    streak_days: number | null;
    is_deactivated: boolean | null;
  };

  return {
    userId: row.user_id,
    displayName: row.display_name ?? "someone",
    avatarUrl: row.avatar_url ?? null,
    bio: row.bio ?? null,
    createdAt: row.created_at ?? null,
    xp: Number(row.xp ?? 0),
    streakDays: Number(row.streak_days ?? 0),
    isDeactivated: Boolean(row.is_deactivated),
  };
}
