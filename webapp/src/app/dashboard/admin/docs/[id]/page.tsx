import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { ForbiddenPanel, Panel } from "@/components/dashboard/ui";
import { fetchAdminDoc, fetchDocCategories } from "@/lib/docs/queries";
import { DocsEditor } from "@/components/dashboard/admin/docs-editor";

export const metadata: Metadata = {
  title: "Admin · Documentation — Beleth backoffice",
};

export default async function AdminDocEditPage({
  params,
  searchParams,
}: PageProps<"/dashboard/admin/docs/[id]">) {
  // The list is read-only for demo-admin; the editor is a write surface.
  const ctx = await getSessionContext();
  if (ctx?.role !== "master_admin") return <ForbiddenPanel />;

  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const categories = await fetchDocCategories();

  if (categories.length === 0) {
    return (
      <Panel title="No categories yet">
        <p className="text-[13px] text-sec">
          Create a category from the documentation list before adding a page.
        </p>
      </Panel>
    );
  }

  if (id === "new") {
    const wanted = Array.isArray(sp?.category) ? sp.category[0] : sp?.category;
    const initialCategory =
      categories.find((c) => c.slug === wanted)?.slug ?? categories[0].slug;
    return (
      <DocsEditor page={null} categories={categories} initialCategory={initialCategory} />
    );
  }

  const page = await fetchAdminDoc(id);
  if (!page) notFound();

  return <DocsEditor page={page} categories={categories} />;
}
