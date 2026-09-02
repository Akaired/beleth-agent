/**
 * A per-account daily ceiling on chat turns.
 *
 * `AIML_API_KEY` is one key with one free-tier quota, shared by everyone who uses the
 * site. Self-signup is open and the demo login is one click from the homepage, so
 * without a per-account limit a single visitor could spend the day's allowance for
 * every other visitor and for the judges. The demo login has its own, smaller,
 * per-browser allowance (`demo-allowance.ts`); this covers registered accounts.
 *
 * Counted from `chat_messages`, which is the transcript the turn writes anyway — no
 * second table to keep in step. It is the API route that spends the key, so the route
 * is where the ceiling has to hold: inserting a row directly through PostgREST writes
 * a transcript entry but calls no model.
 *
 * The window is the UTC day, matching the demo allowance and the upstream reset.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Turns a registered account may take per UTC day. Master admin is exempt. */
export const USER_DAILY_MESSAGES = Number(process.env.CHAT_DAILY_MESSAGES ?? 40);

export const CHAT_QUOTA_EXHAUSTED =
  "You have reached today's message limit. It resets at midnight UTC.";

/** Start of the current UTC day, as an ISO timestamp. */
export function startOfUtcDay(now: Date = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

/**
 * How many turns this account has taken today. Fails **closed-ish**: an unreadable
 * count returns 0, because refusing a legitimate user over a transient Supabase error
 * is worse than one extra turn — the ceiling is a budget guard, not a security
 * boundary, and the session limit still applies.
 */
export async function userTurnsUsedToday(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("chat_messages")
    .select("id, chat_sessions!inner(user_id)", { count: "exact", head: true })
    .eq("role", "user")
    .eq("chat_sessions.user_id", userId)
    .gte("created_at", startOfUtcDay());
  if (error) {
    console.error("chat quota count failed", error);
    return 0;
  }
  return count ?? 0;
}
