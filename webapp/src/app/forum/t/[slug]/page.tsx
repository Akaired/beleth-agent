import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { fetchForumTopic } from "@/lib/forum/queries";
import { PostCard } from "@/components/forum/post-card";
import { ReplyComposer } from "@/components/forum/reply-composer";
import { LoginToPost } from "@/components/forum/login-to-post";
import { TopicManage } from "@/components/forum/topic-manage";
import { ViewPing } from "@/components/forum/view-ping";
import { HighlightCode } from "@/components/forum/highlight-code";
import { TradingViewEmbeds } from "@/components/forum/tradingview-embeds";

export const metadata: Metadata = { title: "Forum — Beleth" };

export default async function ForumTopicPage({
  params,
}: PageProps<"/forum/t/[slug]">) {
  const { slug } = await params;
  const [ctx, data] = await Promise.all([
    getSessionContext(),
    fetchForumTopic(slug),
  ]);
  if (!data) notFound();

  const replies = data.topic.reply_count;
  const views = data.topic.view_count;
  const ownsTopic = !!ctx && ctx.userId === data.topic.author_id;

  return (
    <div className="forum-root flex flex-col gap-5">
      <ViewPing topicId={data.topic.id} />

      <div className="flex flex-col gap-2">
        <Link
          href={`/forum/c/${data.category.slug}`}
          className="flex items-center gap-1.5 text-[11px] text-dim transition-colors hover:text-sec"
        >
          <span
            className="h-2 w-2 rounded-[2px]"
            style={{ background: data.category.color }}
          />
          {data.category.name}
        </Link>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-[20px] font-light leading-snug text-txt">
            {data.topic.title}
          </h1>
          {ownsTopic && (
            <TopicManage
              topicId={data.topic.id}
              categorySlug={data.category.slug}
              title={data.topic.title}
            />
          )}
        </div>
        <div className="font-mono text-[10.5px] text-dim">
          {replies} {replies === 1 ? "reply" : "replies"} · {views}{" "}
          {views === 1 ? "view" : "views"}
        </div>
      </div>

      <HighlightCode
        signature={data.posts.map((p) => `${p.id}:${p.updated_at}`).join("|")}
      />
      <TradingViewEmbeds
        signature={data.posts.map((p) => `${p.id}:${p.updated_at}`).join("|")}
      />

      <div className="flex flex-col gap-3">
        {data.posts.map((p) => (
          <PostCard
            key={p.id}
            post={p}
            original={p.post_number === 1}
            mine={!!ctx && ctx.userId === p.author_id}
            topicSlug={data.topic.slug}
          />
        ))}
      </div>

      {ctx ? (
        <ReplyComposer topicId={data.topic.id} slug={data.topic.slug} />
      ) : (
        <LoginToPost next={`/forum/t/${data.topic.slug}`} />
      )}
    </div>
  );
}
