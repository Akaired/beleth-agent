/**
 * Pure role logic — safe to import from Client Components (no server-only
 * dependencies). The server-side session lookup lives in `src/lib/auth.ts`.
 */
export type Role = "public_user" | "demo_admin" | "master_admin";

const RANK: Record<Role, number> = {
  public_user: 0,
  demo_admin: 1,
  master_admin: 2,
};

export function roleAtLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

/**
 * The shared read-only judges' account. It sees the whole backoffice but may
 * not mutate anything at all: the login is public (one click from the homepage),
 * so whatever it can write, anyone can write. Server actions, route handlers and
 * the database all check this — see db/migrations/0029_demo_readonly_enforcement.sql.
 */
export function isDemoAdmin(role: Role): boolean {
  return role === "demo_admin";
}

/**
 * The single refusal shown whenever the demo account attempts a write. The
 * database raises the same sentence (SQLSTATE 42501) if a path ever reaches it.
 */
export const DEMO_READ_ONLY = "The demo account is read-only.";
