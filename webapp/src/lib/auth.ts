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

export { roleAtLeast } from "@/lib/roles";
export type { Role } from "@/lib/roles";

export type SessionContext = {
  userId: string;
  email: string | null;
  role: Role;
  /** Chosen nickname; when set it replaces the email local-part in the UI. */
  displayName: string | null;
  /** Public URL of the user's avatar image, or null for the initials disc. */
  avatarUrl: string | null;
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
      .select("role, display_name, avatar_url")
      .eq("user_id", user.id)
      .maybeSingle();

    const role = (profile?.role as Role | undefined) ?? "public_user";
    return {
      userId: user.id,
      email: user.email ?? null,
      role,
      displayName: (profile?.display_name as string | null) ?? null,
      avatarUrl: (profile?.avatar_url as string | null) ?? null,
    };
  },
);

/** Redirects to /login when signed out. Use in the dashboard layout. */
export async function requireSession(): Promise<SessionContext> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");
  return ctx;
}
