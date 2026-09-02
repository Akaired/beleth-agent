/**
 * User-roster reads for the backoffice "Users" panel. Everything goes through the
 * `beleth_admin_*` SECURITY DEFINER functions (db/migrations/0019_admin_users.sql),
 * which re-check the caller's role in the database — the webapp has no service-role
 * client. A failure degrades to `[]` so a Supabase hiccup never 500s the page (same
 * discipline as dashboard-queries / docs queries).
 *
 * Reading the roster is open to demo_admin (0026) but the **email column is masked**
 * for it (0031): the demo login is public, one click from the homepage, so anything it
 * reads is published. Only master_admin gets the address in full. The masking happens
 * in the database, not here — this file could not enforce it.
 */
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { levelForXp } from "@/lib/progress";
import type { Role } from "@/lib/roles";

export type AdminUser = {
  userId: string;
  email: string | null;
  role: Role;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: string | null;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  forumTopicCount: number;
  forumPostCount: number;
  chatSessionCount: number;
  xp: number;
  streakDays: number;
  /** Derived from `xp` via the shared ladder (src/lib/progress.ts). */
  level: number;
  levelTitle: string;
};

type Row = Record<string, unknown>;

const ROLES: Role[] = ["public_user", "demo_admin", "master_admin"];

function toRole(v: unknown): Role {
  return ROLES.includes(v as Role) ? (v as Role) : "public_user";
}

function toUser(row: Row): AdminUser {
  const xp = Number(row.xp ?? 0);
  const lvl = levelForXp(xp);
  return {
    userId: String(row.user_id),
    email: (row.email as string | null) ?? null,
    role: toRole(row.role),
    displayName: (row.display_name as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    bio: (row.bio as string | null) ?? null,
    createdAt: (row.created_at as string | null) ?? null,
    lastSignInAt: (row.last_sign_in_at as string | null) ?? null,
    emailConfirmedAt: (row.email_confirmed_at as string | null) ?? null,
    forumTopicCount: Number(row.forum_topic_count ?? 0),
    forumPostCount: Number(row.forum_post_count ?? 0),
    chatSessionCount: Number(row.chat_session_count ?? 0),
    xp,
    streakDays: Number(row.streak_days ?? 0),
    level: lvl.rank.level,
    levelTitle: lvl.rank.title,
  };
}

/** The whole roster, newest sign-up first. `[]` on any error. */
export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("beleth_admin_list_users");
  if (error) console.error("beleth_admin_list_users failed", error);
  if (error || !Array.isArray(data)) return [];
  return (data as Row[]).map(toUser);
}

export type RoleTally = Record<Role, number>;

export function tallyRoles(users: AdminUser[]): RoleTally {
  const t: RoleTally = { public_user: 0, demo_admin: 0, master_admin: 0 };
  for (const u of users) t[u.role] += 1;
  return t;
}
