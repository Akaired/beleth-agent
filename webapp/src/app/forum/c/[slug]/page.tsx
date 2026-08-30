import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { FORUM_PAGE_SIZE, fetchForumCategory } from "@/lib/forum/queries";
import { TopicListTable } from "@/components/forum/topic-list-table";
import { NewTopicButton } from "@/components/forum/new-topic-button";
import { LoginToPost } from "@/components/forum/login-to-post";
import { IconCaretLeft, IconCaretRight } from "@/components/icons";

export const metadata: Metadata = { title: "Forum — Beleth" };

export default async function ForumCategoryPage({
  params,
  searchParams,
}: PageProps<"/forum/c/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  const page = Math.max(
    1,
    Number(Array.isArray(sp?.page) ? sp.page[0] : sp?.page) || 1,
  );

  const [ctx, data] = await Promise.all([
    getSessionContext(),
    fetchForumCategory(slug, page),
  ]);
  if (!data) notFound();

  const pages = Math.max(1, Math.ceil(data.total / FORUM_PAGE_SIZE));
  const clamped = Math.min(page, pages);
  const qs = (p: number) => (p <= 1 ? `/forum/c/${slug}` : `/forum/c/${slug}?page=${p}`);

  return (
    <div className="forum-root flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link
          href="/forum"
          className="text-[11px] text-dim transition-colors hover:text-sec"
        >
          ← Forum
        </Link>
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="flex items-center gap-2 text-[18px] font-light">
            <span
              className="h-2.5 w-2.5 rounded-[2px]"
              style={{ background: data.category.color }}
            />
            {data.category.name}
          </h1>
          {ctx && <NewTopicButton categorySlug={slug} />}
        </div>
        {data.category.description && (
          <p className="text-[12.5px] leading-relaxed text-sec">
            {data.category.description}
          </p>
        )}
      </div>

      <TopicListTable topics={data.topics} />

      {pages > 1 && (
        <div className="flex items-center justify-center gap-4 font-mono text-[11px]">
          {clamped > 1 ? (
            <Link
              href={qs(clamped - 1)}
              className="flex items-center gap-1 text-acc hover:underline"
            >
              <IconCaretLeft size={12} /> newer
            </Link>
          ) : (
            <span className="flex items-center gap-1 text-faint">
              <IconCaretLeft size={12} /> newer
            </span>
          )}
          <span className="text-dim">
            page {clamped}/{pages}
          </span>
          {clamped < pages ? (
            <Link
              href={qs(clamped + 1)}
              className="flex items-center gap-1 text-acc hover:underline"
            >
              older <IconCaretRight size={12} />
            </Link>
          ) : (
            <span className="flex items-center gap-1 text-faint">
              older <IconCaretRight size={12} />
            </span>
          )}
        </div>
      )}

      {!ctx && <LoginToPost next={`/forum/c/${slug}`} />}
    </div>
  );
}
