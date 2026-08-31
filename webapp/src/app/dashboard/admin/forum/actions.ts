"use server";

/**
 * Forum administration writes. The webapp has no service-role client, so every
 * mutation goes through a `beleth_forum_*` SECURITY DEFINER function that
 * re-checks `beleth_role() = 'master_admin'` in the database
 * (db/migrations/0020_forum_admin.sql). These actions add a fast guard on top —
 * a non-master_admin caller never reaches the RPC.
 */

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Result = { ok: true } | { ok: false; error: string };

async function assertMasterAdmin(): Promise<{ ok: false; error: string } | null> {
  const ctx = await getSessionContext();
  if (!ctx || ctx.role !== "master_admin") {
    return { ok: false, error: "Master-admin only." };
  }
  return null;
}

function bump() {
  revalidatePath("/dashboard/admin/forum");
  revalidatePath("/forum", "layout");
}

// ── categories ────────────────────────────────────────────────────────────

export async function saveCategoryAction(input: {
  id: string | null;
  name: string;
  slug: string;
  description: string;
  color: string;
  position: number;
}): Promise<Result> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_forum_category_upsert", {
    p_id: input.id,
    p_name: input.name,
    p_slug: input.slug,
    p_description: input.description,
    p_color: input.color,
    p_position: input.position,
  });
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}

export async function deleteCategoryAction(id: string): Promise<Result> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_forum_category_delete", {
    p_id: id,
  });
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}

export async function reorderCategoriesAction(
  items: Array<{ id: string; position: number }>,
): Promise<Result> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_forum_category_reorder", {
    p_items: items,
  });
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}

// ── topic moderation ──────────────────────────────────────────────────────

type TopicPatch = {
  categoryId?: string;
  pinned?: boolean;
  closed?: boolean;
  title?: string;
};

export async function updateTopicAction(
  topicId: string,
  patch: TopicPatch,
): Promise<Result> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_forum_admin_update_topic", {
    p_topic_id: topicId,
    p_category_id: patch.categoryId ?? null,
    p_pinned: patch.pinned ?? null,
    p_closed: patch.closed ?? null,
    p_title: patch.title ?? null,
  });
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}

export async function deleteTopicAction(topicId: string): Promise<Result> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_forum_admin_delete_topic", {
    p_topic_id: topicId,
  });
  if (error) return { ok: false, error: error.message };
  bump();
  return { ok: true };
}

/** Delete any single reply. Also used from the topic page's inline controls. */
export async function deletePostAction(
  postId: string,
  topicSlug: string,
): Promise<Result> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_forum_admin_delete_post", {
    p_post_id: postId,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/forum/t/${topicSlug}`);
  bump();
  return { ok: true };
}
