"use server";

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionContext, isDemoAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { REMEMBER_COOKIE } from "@/lib/supabase/remember";
import { reportError, userFacingAuthError } from "@/lib/errors";
import { AVATAR_BUCKET } from "@/lib/schema";
import {
  AVATAR_MAX_BYTES,
  BIO_MAX,
  NICKNAME_MAX,
  NICKNAME_MIN,
  describeMaxBytes,
} from "@/lib/limits";
import type {
  AvatarResult,
  FormState,
  LifecycleResult,
} from "@/app/dashboard/settings/account/form-state";

/** The shared read-only judges' account may not change its own identity. */
const DEMO_LOCKED = "The demo account is read-only.";

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Storage path (`<uid>/<file>`) for an avatar public URL, or null if foreign. */
function avatarPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
  const at = url.indexOf(marker);
  return at === -1 ? null : decodeURIComponent(url.slice(at + marker.length));
}

/** Revalidate every surface that shows the viewer's identity. */
function revalidateIdentity(userId: string): void {
  revalidatePath("/dashboard/settings/account");
  revalidatePath("/dashboard");
  revalidatePath(`/u/${userId}`);
}

// ── nickname + bio ─────────────────────────────────────────────────────────
export async function updateProfileAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await getSessionContext();
  if (!ctx) return { error: "Not signed in.", notice: null };
  if (isDemoAdmin(ctx.role)) return { error: DEMO_LOCKED, notice: null };

  const displayName = String(formData.get("display_name") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim();

  if (
    displayName &&
    (displayName.length < NICKNAME_MIN || displayName.length > NICKNAME_MAX)
  ) {
    return {
      error: `Nickname must be ${NICKNAME_MIN} to ${NICKNAME_MAX} characters.`,
      notice: null,
    };
  }
  if (bio.length > BIO_MAX) {
    return { error: `Bio must be ${BIO_MAX} characters or fewer.`, notice: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_update_profile", {
    p_display_name: displayName || null,
    p_bio: bio || null,
  });
  if (error) return { error: reportError("update profile", error), notice: null };

  revalidateIdentity(ctx.userId);
  return { error: null, notice: "Profile saved." };
}

// ── avatar ─────────────────────────────────────────────────────────────────
export async function uploadAvatarAction(
  formData: FormData,
): Promise<AvatarResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (isDemoAdmin(ctx.role)) return { ok: false, error: DEMO_LOCKED };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file." };
  if (file.size > AVATAR_MAX_BYTES) {
    return {
      ok: false,
      error: `Image must be ${describeMaxBytes(AVATAR_MAX_BYTES)} or smaller.`,
    };
  }
  const ext = EXT_BY_TYPE[file.type];
  if (!ext) return { ok: false, error: "PNG, JPEG, GIF or WebP only." };

  const supabase = await createClient();

  // The URL to replace, so the old file can be cleaned up afterwards.
  const { data: current } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  const oldPath = avatarPathFromUrl(current?.avatar_url as string | null);

  const path = `${ctx.userId}/${randomUUID()}.${ext}`;
  const up = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (up.error)
    return { ok: false, error: reportError("avatar upload", up.error, "Upload failed. Please try again.") };

  const { data: pub } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path);
  const { error: rpcError } = await supabase.rpc("beleth_set_avatar_url", {
    p_url: pub.publicUrl,
  });
  if (rpcError) {
    // Roll back the orphaned upload.
    await supabase.storage.from(AVATAR_BUCKET).remove([path]).catch(() => {});
    return { ok: false, error: rpcError.message };
  }

  if (oldPath && oldPath !== path) {
    await supabase.storage.from(AVATAR_BUCKET).remove([oldPath]).catch(() => {});
  }

  revalidateIdentity(ctx.userId);
  return { ok: true, url: pub.publicUrl };
}

export async function removeAvatarAction(): Promise<AvatarResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (isDemoAdmin(ctx.role)) return { ok: false, error: DEMO_LOCKED };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  const oldPath = avatarPathFromUrl(current?.avatar_url as string | null);

  const { error } = await supabase.rpc("beleth_set_avatar_url", { p_url: null });
  if (error) return { ok: false, error: reportError("clear avatar", error) };

  if (oldPath) {
    await supabase.storage.from(AVATAR_BUCKET).remove([oldPath]).catch(() => {});
  }

  revalidateIdentity(ctx.userId);
  return { ok: true, url: null };
}

// ── password ───────────────────────────────────────────────────────────────
export async function changePasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await getSessionContext();
  if (!ctx || !ctx.email) return { error: "Not signed in.", notice: null };
  if (isDemoAdmin(ctx.role)) return { error: DEMO_LOCKED, notice: null };

  const current = String(formData.get("current_password") ?? "");
  const next = String(formData.get("new_password") ?? "");
  const confirm = String(formData.get("confirm_password") ?? "");

  if (!current || !next) {
    return { error: "Fill in every field.", notice: null };
  }
  if (next.length < 8) {
    return { error: "New password must be at least 8 characters.", notice: null };
  }
  if (next !== confirm) {
    return { error: "The new passwords do not match.", notice: null };
  }
  if (next === current) {
    return { error: "The new password matches the current one.", notice: null };
  }

  const supabase = await createClient();

  // Re-authenticate: proves the person at the keyboard knows the current
  // password before we let the live session set a new one.
  const reauth = await supabase.auth.signInWithPassword({
    email: ctx.email,
    password: current,
  });
  if (reauth.error) {
    return { error: "Current password is incorrect.", notice: null };
  }

  const { error } = await supabase.auth.updateUser({ password: next });
  if (error) return { error: userFacingAuthError(error, "Could not update your password."), notice: null };

  return { error: null, notice: "Password updated." };
}

// ── deactivate / delete ────────────────────────────────────────────────────
// Both go through SECURITY DEFINER RPCs (0023). Deactivation is reversible and
// keeps the session — the user lands on /account-deactivated. Deletion removes
// the auth.users row (every user-owned table cascades from there); the session
// is then dead, so we also clear the cookies and send the caller home.

export async function deactivateAccountAction(
  _prev: LifecycleResult | null,
  formData: FormData,
): Promise<LifecycleResult> {
  const ctx = await getSessionContext();
  if (!ctx || !ctx.email) return { ok: false, error: "Not signed in." };

  if (isDemoAdmin(ctx.role)) return { ok: false, error: DEMO_LOCKED };

  const confirm = String(formData.get("confirm_email") ?? "")
    .trim()
    .toLowerCase();
  if (confirm !== ctx.email.toLowerCase()) {
    return { ok: false, error: "Type your email address to confirm." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_deactivate_account");
  if (error) {
    return {
      ok: false,
      error: error.message.includes("master admin")
        ? "The master-admin account can't be deactivated here."
        : reportError("deactivate account", error),
    };
  }

  redirect("/account-deactivated");
}

export async function deleteAccountAction(
  _prev: LifecycleResult | null,
  formData: FormData,
): Promise<LifecycleResult> {
  const ctx = await getSessionContext();
  if (!ctx || !ctx.email) return { ok: false, error: "Not signed in." };

  if (isDemoAdmin(ctx.role)) return { ok: false, error: DEMO_LOCKED };

  const confirm = String(formData.get("confirm_email") ?? "")
    .trim()
    .toLowerCase();
  if (confirm !== ctx.email.toLowerCase()) {
    return { ok: false, error: "Type your email address to confirm." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_delete_account");
  if (error) {
    return {
      ok: false,
      error: error.message.includes("master admin")
        ? "The master-admin account can't be deleted here."
        : reportError("delete account", error),
    };
  }

  // Session is now invalid — tear down what's left client-side.
  await supabase.auth.signOut().catch(() => {});
  (await cookies()).delete(REMEMBER_COOKIE);
  redirect("/?deleted=1");
}
