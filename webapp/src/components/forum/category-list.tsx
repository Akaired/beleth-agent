import type { CSSProperties } from "react";
import Link from "next/link";
import { timeAgo } from "@/lib/forum/format";
import type {
  ForumCategoryWithCount,
  ForumTopicListItem,
} from "@/lib/forum/types";
import { AuthorAvatar } from "@/components/forum/author-avatar";

/**
 * Discourse "Categories" table: one row per category with a 6px coloured left
 * border (`.forum-cat-row`), a description, a topic count, and the most recent
 * topic in that category on the right.
 */
export function CategoryList({
  categories,
  latestByCat,
}: {
  categories: ForumCategoryWithCount[];
  latestByCat: Map<string, ForumTopicListItem>;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-line bg-panel">
      <div className="grid grid-cols-[1fr_minmax(0,300px)] gap-x-6 border-b border-line bg-panel-head px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-sec">
        <span>Category</span>
        <span className="hidden sm:block">Latest</span>
      </div>
      <ul className="divide-y divide-rowline">
        {categories.map((c) => {
          const latest = latestByCat.get(c.slug);
          return (
            <li
              key={c.id}
              className="forum-cat-row grid grid-cols-[1fr] gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-[1fr_minmax(0,300px)]"
              style={{ "--cat-color": c.color } as CSSProperties}
            >
              <div className="min-w-0">
                <Link
                  href={`/forum/c/${c.slug}`}
                  className="flex items-center gap-2 text-[15px] text-txt transition-colors hover:text-acc"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-[2px]"
                    style={{ background: c.color }}
                  />
                  {c.name}
                </Link>
                {c.description && (
                  <p className="mt-1 text-[12.5px] leading-relaxed text-sec">
                    {c.description}
                  </p>
                )}
                <div className="mt-1.5 font-mono text-[10.5px] text-dim">
                  {c.topic_count} topic{c.topic_count === 1 ? "" : "s"}
                </div>
              </div>

              <div className="min-w-0">
                {latest ? (
                  <Link
                    href={`/forum/t/${latest.slug}`}
                    className="flex items-start gap-2"
                  >
                    <AuthorAvatar name={latest.author_name} size={28} />
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] text-txt transition-colors hover:text-acc">
                        {latest.title}
                      </span>
                      <span className="font-mono text-[10.5px] text-dim">
                        {latest.author_name} · {timeAgo(latest.last_posted_at)}
                      </span>
                    </span>
                  </Link>
                ) : (
                  <span className="font-mono text-[10.5px] text-faint">
                    no topics yet
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
