"use server";

/**
 * User-management writes. The webapp has no service-role client, so every
 * write goes through a `beleth_admin_*` SECURITY DEFINER function that
 * re-checks `beleth_role() = 'master_admin'` in the database
 * (db/migrations/0019_admin_users.sql). These actions add a fast guard on top
 * — a non-master_admin caller never reaches the RPC.
 */

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/roles";

type Result = { ok: true } | { ok: false; error: string };

const ROLES: Role[] = ["public_user", "demo_admin", "master_admin"];

async function assertMasterAdmin(): Promise<{ ok: false; error: string } | null> {
  const ctx = await getSessionContext();
  if (!ctx || ctx.role !== "master_admin") {
    return { ok: false, error: "Master-admin only." };
  }
  return null;
}

function bump() {
  revalidatePath("/dashboard/admin/users");
}

export async function setUserRoleAction(
  userId: string,
  role: Role,
): Promise<Result> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;
  if (!ROLES.includes(role)) return { ok: false, error: "Invalid role." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_admin_set_role", {
    p_user_id: userId,
    p_role: role,
  });
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}

export async function deleteUserAction(userId: string): Promise<Result> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_admin_delete_user", {
    p_user_id: userId,
  });
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}

export async function confirmUserEmailAction(userId: string): Promise<Result> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_admin_confirm_email", {
    p_user_id: userId,
  });
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}
