import type { Metadata } from "next";
import { fetchAdminDocList, fetchDocCategories } from "@/lib/docs/queries";
import { DocsAdminList } from "@/components/dashboard/admin/docs-admin-list";

export const metadata: Metadata = {
  title: "Admin · Documentation — Beleth backoffice",
};

export default async function AdminDocsPage() {
  const [pages, categories] = await Promise.all([
    fetchAdminDocList(),
    fetchDocCategories(),
  ]);

  return <DocsAdminList pages={pages} categories={categories} />;
}
