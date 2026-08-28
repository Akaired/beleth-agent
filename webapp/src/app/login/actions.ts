"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error: string | null; notice: string | null };

/** Only allow same-app dashboard paths as a post-login destination. */
function safeNext(raw: string): string {
  if (raw.startsWith("/dashboard")) return raw;
  return "/dashboard";
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

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message, notice: null };

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

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { error: error.message, notice: null };

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
