import type { Metadata } from "next";
import { getSessionContext } from "@/lib/auth";
import { fetchForumCategories, fetchForumLatest } from "@/lib/forum/queries";
import type { ForumTopicListItem } from "@/lib/forum/types";
import { ForumNav } from "@/components/forum/forum-nav";
import { CategoryList } from "@/components/forum/category-list";
import { TopicListTable } from "@/components/forum/topic-list-table";
import { NewTopicButton } from "@/components/forum/new-topic-button";
import { LoginToPost } from "@/components/forum/login-to-post";
import { IconForum } from "@/components/icons";

export const metadata: Metadata = { title: "Forum — Beleth" };

export default async function ForumHomePage({
  searchParams,
}: PageProps<"/forum">) {
  const sp = await searchParams;
  const rawView = Array.isArray(sp?.view) ? sp.view[0] : sp?.view;
  const view = rawView === "latest" ? "latest" : "categories";

  const [ctx, categories, latest] = await Promise.all([
    getSessionContext(),
    fetchForumCategories(),
    fetchForumLatest(50),
  ]);

  // First (most recent) topic per category, for the "Latest" column.
  const latestByCat = new Map<string, ForumTopicListItem>();
  for (const t of latest) {
    if (!latestByCat.has(t.category_slug)) latestByCat.set(t.category_slug, t);
  }

  return (
    <div className="forum-root flex flex-col gap-5">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="flex items-center gap-2 text-[18px] font-light">
          <IconForum size={17} weight="bold" className="text-acc" />
          Forum
        </h1>
        {ctx && <NewTopicButton />}
      </div>

      <ForumNav active={view} />

      {view === "categories" ? (
        <CategoryList categories={categories} latestByCat={latestByCat} />
      ) : (
        <TopicListTable topics={latest} showCategory />
      )}

      {!ctx && <LoginToPost next="/forum" />}
    </div>
  );
}
