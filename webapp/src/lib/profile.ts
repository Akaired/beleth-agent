/**
 * Server-side reads for the account page. RLS lets a signed-in user select
 * exactly their own `profiles` and `user_progress` rows, so the anon-key
 * server client is enough — no service role.
 */
import "server-only";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/roles";
import type { ProgressRow } from "@/lib/progress";

export type AccountProfile = {
  userId: string;
  email: string | null;
  role: Role;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: string | null;
  progress: ProgressRow;
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
      .select("email, role, display_name, avatar_url, bio, created_at")
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
