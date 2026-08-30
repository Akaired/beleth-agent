/**
 * Documentation reads. Public reads go through the cookie-bound anon SSR
 * client and rely on RLS (db/migrations/0016_docs.sql): anyone sees every
 * category and every *published* page. The two admin readers call the
 * `beleth_docs_admin_*` SECURITY DEFINER functions, which return drafts too
 * but only to master_admin. Every fetch degrades to `[]` / `null` on failure
 * so a Supabase hiccup never 500s a page (same discipline as
 * dashboard-queries / forum queries).
 */
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type {
  DocCategory,
  DocNavGroup,
  DocPage,
  DocPageSummary,
} from "@/lib/docs/types";

type Row = Record<string, unknown>;

const SUMMARY_COLS =
  "id,slug,category,title,summary,status,order_index,updated_at,published_at";
const FULL_COLS = `${SUMMARY_COLS},content_md,author_name,seo_title,seo_description,created_at`;

function toSummary(row: Row): DocPageSummary {
  return {
    id: String(row.id),
    slug: String(row.slug),
    category: String(row.category),
    title: String(row.title),
    summary: (row.summary as string | null) ?? null,
    status: row.status === "published" ? "published" : "draft",
    order_index: Number(row.order_index ?? 0),
    updated_at: String(row.updated_at ?? ""),
    published_at: (row.published_at as string | null) ?? null,
  };
}

function toFull(row: Row): DocPage {
  return {
    ...toSummary(row),
    content_md: String(row.content_md ?? ""),
    author_name: (row.author_name as string | null) ?? null,
    seo_title: (row.seo_title as string | null) ?? null,
    seo_description: (row.seo_description as string | null) ?? null,
    created_at: String(row.created_at ?? ""),
  };
}

function toCategory(row: Row): DocCategory {
  return {
    id: String(row.id),
    slug: String(row.slug),
    label: String(row.label),
    position: Number(row.position ?? 0),
  };
}

/** Every category, ordered. */
export async function fetchDocCategories(): Promise<DocCategory[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("docs_categories")
      .select("id,slug,label,position")
      .order("position", { ascending: true });
    return ((data as Row[] | null) ?? []).map(toCategory);
  } catch {
    return [];
  }
}

/** Categories + their published pages, grouped and ordered for the nav. */
export async function fetchPublishedDocNav(): Promise<DocNavGroup[]> {
  try {
    const supabase = await createClient();
    const [{ data: cats }, { data: pages }] = await Promise.all([
      supabase
        .from("docs_categories")
        .select("id,slug,label,position")
        .order("position", { ascending: true }),
      supabase
        .from("docs_pages")
        .select(SUMMARY_COLS)
        .eq("status", "published")
        .order("order_index", { ascending: true }),
    ]);
    const categories = ((cats as Row[] | null) ?? []).map(toCategory);
    const summaries = ((pages as Row[] | null) ?? []).map(toSummary);
    return categories.map((category) => ({
      category,
      pages: summaries.filter((p) => p.category === category.slug),
    }));
  } catch {
    return [];
  }
}

/** Slug of the first published page, by category order then page order. */
export async function fetchFirstPublishedDocSlug(): Promise<string | null> {
  const groups = await fetchPublishedDocNav();
  for (const group of groups) {
    if (group.pages.length > 0) return group.pages[0].slug;
  }
  return null;
}

/** One published page, or null. */
export async function fetchPublishedDocBySlug(
  slug: string,
): Promise<DocPage | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("docs_pages")
      .select(FULL_COLS)
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle();
    return data ? toFull(data as Row) : null;
  } catch {
    return null;
  }
}

// ── admin (master_admin only, drafts included) ─────────────────────────────

/** Every page, published or draft, ordered by category + position. */
export async function fetchAdminDocList(): Promise<DocPage[]> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("beleth_docs_admin_list");
    if (error) return [];
    return ((data as Row[] | null) ?? []).map(toFull);
  } catch {
    return [];
  }
}

/** One page by id, published or draft, or null. */
export async function fetchAdminDoc(id: string): Promise<DocPage | null> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("beleth_docs_admin_get", {
      p_id: id,
    });
    if (error || !data) return null;
    const row = (Array.isArray(data) ? data[0] : data) as Row;
    return toFull(row);
  } catch {
    return null;
  }
}
