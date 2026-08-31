import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionContext, isDemoAdmin, roleAtLeast } from "@/lib/auth";
import { fetchForumCategories } from "@/lib/forum/queries";
import { NewTopicForm } from "@/components/forum/new-topic-form";
import { IconForum } from "@/components/icons";

export const metadata: Metadata = { title: "New topic — Beleth forum" };

export default async function NewForumTopicPage({
  searchParams,
}: PageProps<"/forum/new">) {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login?next=/forum/new");

  const sp = await searchParams;
  const preset = Array.isArray(sp?.category) ? sp.category[0] : sp?.category;
  const allCategories = await fetchForumCategories();
  // A locked category (0028) only takes topics from master_admin; hide it from
  // everyone else so the picker never offers a choice the DB will reject.
  const canPostLocked = roleAtLeast(ctx.role, "master_admin");
  const categories = allCategories.filter(
    (c) => canPostLocked || !c.admin_only_topics,
  );

  return (
    <div className="forum-root flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link
          href="/forum"
          className="text-[11px] text-dim transition-colors hover:text-sec"
        >
          ← Forum
        </Link>
        <h1 className="flex items-center gap-2 text-[18px] font-light">
          <IconForum size={17} weight="bold" className="text-acc" />
          New topic
        </h1>
      </div>

      {categories.length === 0 ? (
        <p className="text-[13px] text-dim">
          No categories are available right now.
        </p>
      ) : (
        <NewTopicForm
          categories={categories.map((c) => ({ slug: c.slug, name: c.name }))}
          defaultCategory={preset}
          isDemo={isDemoAdmin(ctx.role)}
        />
      )}
    </div>
  );
}
