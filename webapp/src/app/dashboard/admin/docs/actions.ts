"use server";

/**
 * Documentation writes. The webapp has no service-role client, so every write
 * goes through a `beleth_docs_*` SECURITY DEFINER function that re-checks
 * `beleth_role() = 'master_admin'` in the database (db/migrations/0016_docs.sql).
 * These actions add a fast, friendly guard on top of that — a non-master_admin
 * caller never reaches the RPC.
 */

import { revalidatePath } from "next/cache";
import { getSessionContext, isMasterAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { renderDocMarkdown } from "@/lib/docs/markdown";
import type { DocStatus } from "@/lib/docs/types";
import { reportError } from "@/lib/errors";

type Result = { ok: true } | { ok: false; error: string };
type SaveResult = { ok: true; id: string; slug: string } | { ok: false; error: string };

async function assertMasterAdmin(): Promise<{ ok: false; error: string } | null> {
  const ctx = await getSessionContext();
  if (!ctx || !isMasterAdmin(ctx.role)) {
    return { ok: false, error: "Master-admin only." };
  }
  return null;
}

function bump() {
  revalidatePath("/dashboard/admin/docs");
  revalidatePath("/docs", "layout");
}

export type SavePageInput = {
  id: string | null;
  title: string;
  slug: string;
  category: string;
  summary: string;
  content_md: string;
  order_index: number;
  seo_title: string;
  seo_description: string;
};

/** Create (id null) or update one page. Never touches status / published_at. */
export async function savePageAction(input: SavePageInput): Promise<SaveResult> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("beleth_docs_upsert_page", {
    p_id: input.id,
    p_title: input.title,
    p_slug: input.slug,
    p_category: input.category,
    p_summary: input.summary,
    p_content_md: input.content_md,
    p_order_index: input.order_index,
    p_seo_title: input.seo_title,
    p_seo_description: input.seo_description,
  });
  if (error || !data) {
    return { ok: false, error: error?.message ?? "Could not save the page." };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { id: string; slug: string };
  bump();
  return { ok: true, id: row.id, slug: row.slug };
}

export async function setPageStatusAction(
  id: string,
  status: DocStatus,
): Promise<Result> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_docs_set_status", {
    p_id: id,
    p_status: status,
  });
  if (error) return { ok: false, error: reportError("docs admin", error) };
  bump();
  return { ok: true };
}

export async function deletePageAction(id: string): Promise<Result> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_docs_delete", { p_id: id });
  if (error) return { ok: false, error: reportError("docs admin", error) };
  bump();
  return { ok: true };
}

export async function reorderPagesAction(
  items: Array<{ id: string; order_index: number }>,
): Promise<Result> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_docs_reorder", { p_items: items });
  if (error) return { ok: false, error: reportError("docs admin", error) };
  bump();
  return { ok: true };
}

export async function saveCategoryAction(input: {
  id: string | null;
  label: string;
  slug: string;
  position: number;
}): Promise<Result> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_docs_category_upsert", {
    p_id: input.id,
    p_label: input.label,
    p_slug: input.slug,
    p_position: input.position,
  });
  if (error) return { ok: false, error: reportError("docs admin", error) };
  bump();
  return { ok: true };
}

export async function deleteCategoryAction(id: string): Promise<Result> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_docs_category_delete", { p_id: id });
  if (error) return { ok: false, error: reportError("docs admin", error) };
  bump();
  return { ok: true };
}

export async function reorderCategoriesAction(
  items: Array<{ id: string; position: number }>,
): Promise<Result> {
  const denied = await assertMasterAdmin();
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_docs_category_reorder", {
    p_items: items,
  });
  if (error) return { ok: false, error: reportError("docs admin", error) };
  bump();
  return { ok: true };
}

/** Render Markdown exactly as the public page will — the editor's live preview. */
export async function previewMarkdownAction(
  md: string,
): Promise<{ html: string }> {
  const denied = await assertMasterAdmin();
  if (denied) return { html: "" };
  return { html: renderDocMarkdown(md).html };
}
