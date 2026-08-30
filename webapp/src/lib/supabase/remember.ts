/**
 * "Remember me" session lifetime.
 *
 * By default the app only remembers you for a short, *sliding* window: the
 * Supabase auth cookies are clamped to {@link SHORT_SESSION_SECONDS}, and
 * because the proxy re-issues them on every request, an active tab keeps
 * getting a fresh 15-minute window. Go idle for longer and the cookies
 * expire — next request lands on `/login`.
 *
 * Tick "remember me on this device" at sign-in and we drop a
 * {@link REMEMBER_COOKIE}; while it is present the auth cookies get
 * {@link LONG_SESSION_SECONDS} instead.
 *
 * Both the server client (`server.ts`) and the proxy read the flag and call
 * {@link applySessionLifetime} on every cookie write, so the two stay in sync.
 */

export const REMEMBER_COOKIE = "beleth-remember";

/** Sliding session when "remember me" is off — 15 minutes of inactivity. */
export const SHORT_SESSION_SECONDS = 15 * 60;

/** Persistent session when "remember me" is on — 30 days. */
export const LONG_SESSION_SECONDS = 60 * 60 * 24 * 30;

type SettableCookie = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

/**
 * Clamp the lifetime of Supabase auth cookies (`sb-*`) to match the
 * remember-me choice. Non-Supabase cookies pass through untouched.
 */
export function applySessionLifetime<T extends SettableCookie>(
  cookiesToSet: T[],
  remembered: boolean,
): T[] {
  const maxAge = remembered ? LONG_SESSION_SECONDS : SHORT_SESSION_SECONDS;
  return cookiesToSet.map((cookie) => {
    if (!cookie.name.startsWith("sb-")) return cookie;
    return {
      ...cookie,
      options: { ...(cookie.options ?? {}), maxAge, expires: undefined },
    };
  });
}
