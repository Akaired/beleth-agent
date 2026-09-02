import type { Metadata } from "next";
import { getSessionContext, isMasterAdmin } from "@/lib/auth";
import { fetchForumCategories, fetchAllForumTopics } from "@/lib/forum/queries";
import { ForumAdmin } from "@/components/dashboard/admin/forum-admin";

export const metadata: Metadata = {
  title: "Admin · Forum — Beleth backoffice",
};

export default async function AdminForumPage() {
  const [ctx, categories, topics] = await Promise.all([
    getSessionContext(),
    fetchForumCategories(),
    fetchAllForumTopics(),
  ]);

  return (
    <ForumAdmin
      categories={categories}
      topics={topics}
      canWrite={!!ctx && isMasterAdmin(ctx.role)}
    />
  );
}
