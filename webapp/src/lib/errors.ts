/**
 * What an error is allowed to say to a visitor.
 *
 * Server actions and route handlers were returning `error.message` straight from
 * Supabase, Postgres, Storage or Resend. Most of the time that message is ours — the
 * `beleth_*` functions `raise exception` with sentences written for the person reading
 * them ("The demo account is read-only.", "title must be 3 to 120 characters"). The
 * rest of the time it is not: a constraint name, a function signature, a PostgREST
 * hint, a vendor's internal detail. Those describe the schema to anyone who can
 * provoke them, and they read as noise to everyone else.
 *
 * The SQLSTATE tells the two apart. Our functions raise with a deliberate code, or
 * with none at all, which plpgsql reports as P0001. Anything else — a unique violation
 * naming an index, a check constraint naming a column, a transport failure — is
 * replaced by a fixed sentence, and the real error is logged on the server where it is
 * useful.
 *
 * Client-safe: no `server-only`, so a Client Component can share the fallback copy.
 */

/**
 * SQLSTATEs our own migrations raise on purpose, whose message is the user-facing
 * text. `P0001` is a bare `raise exception`; the others are the codes the
 * `beleth_*` functions attach explicitly.
 */
const DELIBERATE_SQLSTATES = new Set(["P0001", "P0002", "22023", "23503", "42501"]);

export const GENERIC_ERROR = "Something went wrong. Please try again.";

type SupabaseLikeError = {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
};

/** The message to show. Anything unrecognised becomes `fallback`. */
export function userFacingError(
  error: SupabaseLikeError | null | undefined,
  fallback: string = GENERIC_ERROR,
): string {
  if (!error) return fallback;
  const code = typeof error.code === "string" ? error.code : "";
  const message = typeof error.message === "string" ? error.message.trim() : "";
  if (!message) return fallback;
  if (!DELIBERATE_SQLSTATES.has(code)) return fallback;
  // Our own messages are single sentences; anything longer did not come from us.
  return message.length > 300 ? fallback : message;
}

/**
 * Log the real error where it is useful, then return what the visitor may see.
 * `where` names the call site so a server log line is searchable.
 */
export function reportError(
  where: string,
  error: SupabaseLikeError | null | undefined,
  fallback: string = GENERIC_ERROR,
): string {
  if (error) console.error(`${where} failed`, error);
  return userFacingError(error, fallback);
}

/**
 * Auth errors come from GoTrue, not Postgres: "Invalid login credentials", "User
 * already registered", "Email not confirmed". They are written for the person signing
 * in and carry no schema detail, so they pass through — bounded, and with a fallback
 * for the unexpected.
 */
export function userFacingAuthError(
  error: { message?: unknown } | null | undefined,
  fallback: string = "Could not sign you in. Please try again.",
): string {
  const message =
    error && typeof error.message === "string" ? error.message.trim() : "";
  if (!message || message.length > 200) return fallback;
  return message;
}
