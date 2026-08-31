import type { Metadata } from "next";
import { getSessionContext } from "@/lib/auth";
import { fetchAdminDocList, fetchDocCategories } from "@/lib/docs/queries";
import { DocsAdminList } from "@/components/dashboard/admin/docs-admin-list";

export const metadata: Metadata = {
  title: "Admin · Documentation — Beleth backoffice",
};

export default async function AdminDocsPage() {
  const [ctx, pages, categories] = await Promise.all([
    getSessionContext(),
    fetchAdminDocList(),
    fetchDocCategories(),
  ]);

  return (
    <DocsAdminList
      pages={pages}
      categories={categories}
      canWrite={ctx?.role === "master_admin"}
    />
  );
}
