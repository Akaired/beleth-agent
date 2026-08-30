"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error: string | null; notice: string | null };
export const EMPTY_STATE: FormState = { error: null, notice: null };

const AVATAR_BUCKET = "avatars";
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
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

// ── nickname + bio ─────────────────────────────────────────────────────────
export async function updateProfileAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await getSessionContext();
  if (!ctx) return { error: "Not signed in.", notice: null };

  const displayName = String(formData.get("display_name") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim();

  if (displayName && (displayName.length < 2 || displayName.length > 40)) {
    return { error: "Nickname must be 2 to 40 characters.", notice: null };
  }
  if (bio.length > 280) {
    return { error: "Bio must be 280 characters or fewer.", notice: null };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_update_profile", {
    p_display_name: displayName || null,
    p_bio: bio || null,
  });
  if (error) return { error: error.message, notice: null };

  revalidatePath("/dashboard/account");
  revalidatePath("/dashboard");
  return { error: null, notice: "Profile saved." };
}

// ── avatar ─────────────────────────────────────────────────────────────────
export type AvatarResult =
  | { ok: true; url: string | null }
  | { ok: false; error: string };

export async function uploadAvatarAction(
  formData: FormData,
): Promise<AvatarResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file." };
  if (file.size > MAX_AVATAR_BYTES) {
    return { ok: false, error: "Image must be 2 MB or smaller." };
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
  if (up.error) return { ok: false, error: up.error.message };

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

  revalidatePath("/dashboard/account");
  revalidatePath("/dashboard");
  return { ok: true, url: pub.publicUrl };
}

export async function removeAvatarAction(): Promise<AvatarResult> {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: "Not signed in." };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  const oldPath = avatarPathFromUrl(current?.avatar_url as string | null);

  const { error } = await supabase.rpc("beleth_set_avatar_url", { p_url: null });
  if (error) return { ok: false, error: error.message };

  if (oldPath) {
    await supabase.storage.from(AVATAR_BUCKET).remove([oldPath]).catch(() => {});
  }

  revalidatePath("/dashboard/account");
  revalidatePath("/dashboard");
  return { ok: true, url: null };
}

// ── password ───────────────────────────────────────────────────────────────
export async function changePasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await getSessionContext();
  if (!ctx || !ctx.email) return { error: "Not signed in.", notice: null };

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
  if (error) return { error: error.message, notice: null };

  return { error: null, notice: "Password updated." };
}
