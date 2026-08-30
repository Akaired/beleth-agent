/**
 * Shared types for the documentation section. Safe to import from Client
 * Components (no server-only dependency). The reads live in
 * `src/lib/docs/queries.ts`, the writes in
 * `src/app/dashboard/admin/docs/actions.ts`.
 */

export type DocStatus = "draft" | "published";

export type DocCategory = {
  id: string;
  slug: string;
  label: string;
  position: number;
};

/** Row shape for the admin list and the public nav — no `content_md`. */
export type DocPageSummary = {
  id: string;
  slug: string;
  category: string;
  title: string;
  summary: string | null;
  status: DocStatus;
  order_index: number;
  updated_at: string;
  published_at: string | null;
};

/** A full page, as returned to the editor and rendered on the public page. */
export type DocPage = DocPageSummary & {
  content_md: string;
  author_name: string | null;
  seo_title: string | null;
  seo_description: string | null;
  created_at: string;
};

export type DocHeading = {
  id: string;
  text: string;
  level: 2 | 3;
};

/** One category with its pages, for the grouped nav. */
export type DocNavGroup = {
  category: DocCategory;
  pages: DocPageSummary[];
};
