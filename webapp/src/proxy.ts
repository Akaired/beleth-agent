/**
 * Proxy (Next 16's renamed `middleware`). Two jobs:
 *
 *   1. Refresh the Supabase auth session on every request and write the
 *      rotated cookies onto the response — Server Components cannot set
 *      cookies, so this is the only place the session stays fresh.
 *   2. Gate `/dashboard/*`: no user → bounce to `/login`.
 *
 * Role checks (demo_admin / master_admin) are NOT done here — they need a
 * DB read per request and belong next to the data. See `src/lib/auth.ts`.
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { applySessionLifetime, REMEMBER_COOKIE } from "@/lib/supabase/remember";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const remembered = request.cookies.get(REMEMBER_COOKIE)?.value === "1";

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          const adjusted = applySessionLifetime(cookiesToSet, remembered);
          for (const { name, value } of adjusted) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of adjusted) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Do not run code between createServerClient and getUser() — it revalidates
  // the token and refreshes cookies as a side effect.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  if (!user && pathname.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
