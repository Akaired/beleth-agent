/**
 * Client-safe slugify — the editor's live "/docs/…" preview. The database
 * de-duplicates on write (beleth_docs_slugify + a uniqueness loop), so this
 * only has to produce the same *base* shape.
 */
export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "page"
  );
}
