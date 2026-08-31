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
 * not mutate anything — the one exception is posting on the forum under a
 * per-post "(demo)" alias. Server actions and DB functions both check this.
 */
export function isDemoAdmin(role: Role): boolean {
  return role === "demo_admin";
}
