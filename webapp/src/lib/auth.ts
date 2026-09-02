/**
 * Data access layer for auth. Every server component / action that needs the
 * viewer's identity or role goes through here, so the auth check is never
 * skipped. `cache()` dedupes the work within a single request.
 */
import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/roles";

export type AccountStatus = "active" | "deactivated";

export { roleAtLeast, isDemoAdmin, DEMO_READ_ONLY } from "@/lib/roles";
export type { Role } from "@/lib/roles";

export type SessionContext = {
  userId: string;
  email: string | null;
  role: Role;
  /** Chosen nickname; when set it replaces the email local-part in the UI. */
  displayName: string | null;
  /** Public URL of the user's avatar image, or null for the initials disc. */
  avatarUrl: string | null;
  /** 'deactivated' users are bounced to the terminal /account-deactivated screen. */
  status: AccountStatus;
};

/**
 * The viewer's session + role, or null when signed out. Reads the profile
 * row (RLS: a user can read only their own) to get the role, nickname and
 * avatar; falls back to `public_user` if the row is missing (e.g. a race with
 * the signup trigger).
 */
export const getSessionContext = cache(
  async (): Promise<SessionContext | null> => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, display_name, avatar_url, status")
      .eq("user_id", user.id)
      .maybeSingle();

    const role = (profile?.role as Role | undefined) ?? "public_user";
    return {
      userId: user.id,
      email: user.email ?? null,
      role,
      displayName: (profile?.display_name as string | null) ?? null,
      avatarUrl: (profile?.avatar_url as string | null) ?? null,
      status:
        (profile?.status as AccountStatus | undefined) === "deactivated"
          ? "deactivated"
          : "active",
    };
  },
);

/**
 * Redirects to /login when signed out. A deactivated account is sent to the
 * terminal /account-deactivated screen — it holds a valid session but may not
 * use the dashboard until it reactivates.
 */
export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  if (ctx.status === "deactivated") redirect("/account-deactivated");
  return ctx;
}
