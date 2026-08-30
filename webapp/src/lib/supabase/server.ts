/**
 * Server-side Supabase client (App Router). Reads/writes the auth cookies
 * through Next's async `cookies()` store, so a Server Component, Route
 * Handler, or Server Action all share one session.
 *
 * Same public env as the anon homepage reader (`src/lib/supabase.ts`):
 * `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Visibility
 * is enforced by RLS, never by key secrecy — the service-role key never
 * touches this app.
 */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { applySessionLifetime, REMEMBER_COOKIE } from "@/lib/supabase/remember";

export async function createClient() {
  const cookieStore = await cookies();
  const remembered = cookieStore.get(REMEMBER_COOKIE)?.value === "1";

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Throws when called from a Server Component render (cookies are
          // read-only there). The session is refreshed in `src/proxy.ts`
          // instead, so swallowing this is safe.
          try {
            for (const { name, value, options } of applySessionLifetime(
              cookiesToSet,
              remembered,
            )) {
              cookieStore.set(name, value, options);
            }
          } catch {
            /* no-op: refresh handled in proxy */
          }
        },
      },
    },
  );
}
