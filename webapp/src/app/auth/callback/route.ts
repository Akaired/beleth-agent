/**
 * OAuth / password-recovery callback. Supabase redirects here with a `code`
 * (PKCE); we exchange it for a session (cookies written through the server
 * client) and forward to `next`.
 */
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

  const rawNext = searchParams.get("next") ?? "/dashboard";
  const next =
    rawNext.startsWith("/dashboard") || rawNext === "/login/update-password"
      ? rawNext
      : "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
