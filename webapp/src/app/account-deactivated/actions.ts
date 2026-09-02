"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { REMEMBER_COOKIE } from "@/lib/supabase/remember";
import { reportError } from "@/lib/errors";

export type ReactivateResult = { ok: true } | { ok: false; error: string };

export async function reactivateAccountAction(): Promise<ReactivateResult> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login");

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_reactivate_account");
  if (error) return { ok: false, error: reportError("account reactivate", error) };

  redirect("/dashboard");
}

export async function signOutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(REMEMBER_COOKIE);
  redirect("/login");
}
