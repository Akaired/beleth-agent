"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { userFacingAuthError } from "@/lib/errors";
import {
  LONG_SESSION_SECONDS,
  REMEMBER_COOKIE,
} from "@/lib/supabase/remember";

export type AuthState = { error: string | null; notice: string | null };

/** Only allow same-app dashboard paths as a post-login destination. */
function safeNext(raw: string): string {
  if (raw.startsWith("/dashboard")) return raw;
  return "/dashboard";
}

/**
 * Persist (or clear) the remember-me flag. Must run *before* the Supabase
 * client is created so the auth cookies it writes get the right lifetime.
 */
async function setRemember(remember: boolean): Promise<void> {
  const store = await cookies();
  if (remember) {
    store.set(REMEMBER_COOKIE, "1", {
      maxAge: LONG_SESSION_SECONDS,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  } else {
    store.delete(REMEMBER_COOKIE);
  }
}

async function originUrl(): Promise<string> {
  const h = await headers();
  return (
    h.get("origin") ??
    `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`
  );
}

export async function signInAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? ""));

  if (!email || !password) {
    return { error: "Email and password are required.", notice: null };
  }

  await setRemember(formData.get("remember") === "on");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: userFacingAuthError(error), notice: null };

  redirect(next);
}

export async function signUpAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? ""));

  if (!email || !password) {
    return { error: "Email and password are required.", notice: null };
  }
  if (password.length < 8) {
    return { error: "Password must be at least 8 characters.", notice: null };
  }

  await setRemember(formData.get("remember") === "on");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error)
    return { error: userFacingAuthError(error, "Could not create the account."), notice: null };

  // Email confirmation is currently disabled on the project (mailer_autoconfirm),
  // so signUp returns a live session. Keep the fallback in case that changes.
  if (!data.session) {
    return {
      error: null,
      notice: "Account created. Check your email to confirm, then sign in.",
    };
  }

  redirect(next);
}

/**
 * One-click "Demo" button on the public homepage. Signs in with the shared
 * read-only judges' account (profiles.role = 'demo_admin') using credentials
 * held server-side only, then drops the visitor into the backoffice. Falls back
 * to /login when the env vars are not configured.
 */
export async function demoSignInAction(): Promise<void> {
  const email = process.env.DEMO_EMAIL?.trim();
  const password = process.env.DEMO_PASSWORD ?? "";
  if (!email || !password) redirect("/login");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect("/login");

  redirect("/dashboard");
}

export async function resetPasswordAction(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    return { error: "Enter the email on your account.", notice: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await originUrl()}/auth/callback?next=/login/update-password`,
  });
  if (error)
    return { error: userFacingAuthError(error, "Could not send the reset link."), notice: null };

  return {
    error: null,
    notice:
      "If that email has an account, a reset link is on its way. It only works once SMTP is configured on the project.",
  };
}
