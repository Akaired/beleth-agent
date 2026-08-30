import Link from "next/link";
import { timeAgo } from "@/lib/forum/format";
import type { ForumTopicListItem } from "@/lib/forum/types";
import { AuthorAvatar } from "@/components/forum/author-avatar";

/**
 * Discourse topic list: title (+ author, + category badge on the Latest view) |
 * Replies | Views | Activity. Styling in the `.forum-table` block in globals.css.
 */
export function TopicListTable({
  topics,
  showCategory = false,
}: {
  topics: ForumTopicListItem[];
  showCategory?: boolean;
}) {
  if (topics.length === 0) {
    return (
      <div className="rounded-md border border-line bg-panel p-8 text-center text-[13px] text-dim">
        No topics yet. Be the first to start one.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-line bg-panel">
      <table className="forum-table">
        <thead>
          <tr>
            <th>Topic</th>
            <th className="forum-num">Replies</th>
            <th className="forum-num">Views</th>
            <th className="forum-activity">Activity</th>
          </tr>
        </thead>
        <tbody>
          {topics.map((t) => (
            <tr key={t.id}>
              <td>
                <Link
                  href={`/forum/t/${t.slug}`}
                  className="flex items-center gap-2.5"
                >
                  <AuthorAvatar name={t.author_name} size={30} />
                  <span className="min-w-0">
                    <span className="block text-[13.5px] text-txt transition-colors hover:text-acc">
                      {t.title}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-dim">
                      {showCategory && (
                        <span className="inline-flex items-center gap-1">
                          <span
                            className="h-2 w-2 rounded-[2px]"
                            style={{ background: t.category_color }}
                          />
                          {t.category_name}
                        </span>
                      )}
                      <span>{t.author_name}</span>
                    </span>
                  </span>
                </Link>
              </td>
              <td className="forum-num">{t.reply_count}</td>
              <td className="forum-num">{t.view_count}</td>
              <td className="forum-activity">{timeAgo(t.last_posted_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
