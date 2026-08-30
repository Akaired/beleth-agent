/**
 * Is a Supabase auth-token cookie present? `@supabase/ssr` does not mark it
 * httpOnly (the browser client needs to read it), so this is a synchronous,
 * network-free signal a client island can trust for its first render, before
 * `getUser()` confirms.
 */
export function hasSupabaseAuthCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split("; ")
    .some((c) => /^sb-[^=]*-auth-token(\.\d+)?=./.test(c));
}
