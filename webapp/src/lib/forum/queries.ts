/**
 * Forum reads. Everything goes through the authenticated SSR Supabase client;
 * RLS (db/migrations/0008_forum.sql) opens `select` to anon + authenticated, so
 * a logged-out visitor gets the same rows. Reads only — writes live in
 * `src/lib/forum/actions.ts`. Each fetch degrades to `[]` / `null` on failure so
 * a Supabase hiccup never 500s the page (same discipline as dashboard-queries).
 */
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { sanitizeForumHtml } from "@/lib/forum/sanitize";
import type {
  ForumCategoryWithCount,
  ForumPost,
  ForumRecentTopic,
  ForumTopicDetail,
  ForumTopicListItem,
} from "@/lib/forum/types";

export const FORUM_PAGE_SIZE = 20;

const TOPIC_LIST_COLS =
  "id,slug,title,author_name,created_at,last_posted_at,reply_count,view_count,pinned,closed,category_id";

type Row = Record<string, unknown>;
type CatEmbed = { slug?: string; name?: string; color?: string };

function flattenTopic(row: Row): ForumTopicListItem {
  const cat = (row.forum_categories ?? {}) as CatEmbed;
  return {
    id: String(row.id),
    slug: String(row.slug),
    title: String(row.title),
    author_name: String(row.author_name ?? ""),
    created_at: String(row.created_at),
    last_posted_at: String(row.last_posted_at),
    reply_count: Number(row.reply_count ?? 0),
    view_count: Number(row.view_count ?? 0),
    pinned: Boolean(row.pinned ?? false),
    closed: Boolean(row.closed ?? false),
    category_id: String(row.category_id ?? ""),
    category_slug: cat.slug ?? "",
    category_name: cat.name ?? "",
    category_color: cat.color ?? "#8c959d",
  };
}

/** All categories, ordered, each with its topic count — the landing page. */
export async function fetchForumCategories(): Promise<ForumCategoryWithCount[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("forum_categories")
      .select("id,slug,name,description,color,position,forum_topics(count)")
      .order("position", { ascending: true });
    return ((data as Row[] | null) ?? []).map((c) => ({
      id: String(c.id),
      slug: String(c.slug),
      name: String(c.name),
      description: (c.description as string | null) ?? null,
      color: String(c.color ?? "#8c959d"),
      position: Number(c.position ?? 0),
      topic_count: Number(
        (Array.isArray(c.forum_topics)
          ? (c.forum_topics[0] as { count?: number } | undefined)?.count
          : 0) ?? 0,
      ),
    }));
  } catch (err) {
    console.error("fetchForumCategories failed", err);
    return [];
  }
}

/**
 * The signed-in viewer's own most recently started topics — the indented
 * "recent" list under Forum in the sidebar, mirroring recent chats. Empty for
 * a logged-out visitor or one who has never posted.
 */
export async function fetchRecentForumTopicsByAuthor(
  authorId: string,
  limit = 3,
): Promise<ForumRecentTopic[]> {
  if (!authorId) return [];
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("forum_topics")
      .select("id,slug,title")
      .eq("author_id", authorId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return ((data as Row[] | null) ?? []).map((r) => ({
      id: String(r.id),
      slug: String(r.slug),
      title: String(r.title),
    }));
  } catch (err) {
    console.error("fetchRecentForumTopicsByAuthor failed", err);
    return [];
  }
}

/** Most recently active topics across every category — the "Latest" view. */
export async function fetchForumLatest(limit = 40): Promise<ForumTopicListItem[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("forum_topics")
      .select(`${TOPIC_LIST_COLS},forum_categories!inner(slug,name,color)`)
      .order("pinned", { ascending: false })
      .order("last_posted_at", { ascending: false })
      .limit(limit);
    return ((data as Row[] | null) ?? []).map(flattenTopic);
  } catch (err) {
    console.error("fetchForumLatest failed", err);
    return [];
  }
}

/**
 * Every topic with its category flattened in, newest activity first — the
 * source for the admin moderation table. Reads through the same anon/SSR
 * client (RLS opens `select` to everyone); the writes are master-admin only.
 */
export async function fetchAllForumTopics(
  limit = 500,
): Promise<ForumTopicListItem[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("forum_topics")
      .select(`${TOPIC_LIST_COLS},forum_categories!inner(slug,name,color)`)
      .order("last_posted_at", { ascending: false })
      .limit(limit);
    return ((data as Row[] | null) ?? []).map(flattenTopic);
  } catch (err) {
    console.error("fetchAllForumTopics failed", err);
    return [];
  }
}

export type ForumCategoryPage = {
  category: {
    slug: string;
    name: string;
    description: string | null;
    color: string;
  };
  topics: ForumTopicListItem[];
  total: number;
  page: number;
};

/** One category and a page of its topics (newest activity first). */
export async function fetchForumCategory(
  slug: string,
  page = 1,
): Promise<ForumCategoryPage | null> {
  try {
    const supabase = await createClient();
    const { data: cat } = await supabase
      .from("forum_categories")
      .select("id,slug,name,description,color")
      .eq("slug", slug)
      .maybeSingle();
    if (!cat) return null;
    const c = cat as Row;

    const from = (page - 1) * FORUM_PAGE_SIZE;
    const { data, count } = await supabase
      .from("forum_topics")
      .select(TOPIC_LIST_COLS, { count: "exact" })
      .eq("category_id", c.id as string)
      .order("pinned", { ascending: false })
      .order("last_posted_at", { ascending: false })
      .range(from, from + FORUM_PAGE_SIZE - 1);

    const topics = ((data as Row[] | null) ?? []).map((r) =>
      flattenTopic({
        ...r,
        forum_categories: { slug: c.slug, name: c.name, color: c.color },
      }),
    );

    return {
      category: {
        slug: String(c.slug),
        name: String(c.name),
        description: (c.description as string | null) ?? null,
        color: String(c.color ?? "#8c959d"),
      },
      topics,
      total: count ?? 0,
      page,
    };
  } catch (err) {
    console.error("fetchForumCategory failed", err);
    return null;
  }
}

/** One topic with its full post list, ordered original-post first. */
export async function fetchForumTopic(
  slug: string,
): Promise<ForumTopicDetail | null> {
  try {
    const supabase = await createClient();
    const { data: topic } = await supabase
      .from("forum_topics")
      .select(`${TOPIC_LIST_COLS},author_id,forum_categories!inner(slug,name,color)`)
      .eq("slug", slug)
      .maybeSingle();
    if (!topic) return null;
    const t = topic as Row;
    const cat = (t.forum_categories ?? {}) as CatEmbed;

    const { data: posts } = await supabase
      .from("forum_posts")
      .select("id,author_id,author_name,body,post_number,created_at,updated_at")
      .eq("topic_id", t.id as string)
      .order("post_number", { ascending: true });

    return {
      topic: {
        id: String(t.id),
        slug: String(t.slug),
        title: String(t.title),
        author_id: String(t.author_id ?? ""),
        author_name: String(t.author_name ?? ""),
        created_at: String(t.created_at),
        last_posted_at: String(t.last_posted_at),
        reply_count: Number(t.reply_count ?? 0),
        view_count: Number(t.view_count ?? 0),
        pinned: Boolean(t.pinned ?? false),
        closed: Boolean(t.closed ?? false),
      },
      category: {
        slug: cat.slug ?? "",
        name: cat.name ?? "",
        color: cat.color ?? "#8c959d",
      },
      posts: ((posts as Row[] | null) ?? []).map<ForumPost>((p) => ({
        id: String(p.id),
        author_id: String(p.author_id ?? ""),
        author_name: String(p.author_name ?? ""),
        body: sanitizeForumHtml(String(p.body ?? "")),
        post_number: Number(p.post_number ?? 1),
        created_at: String(p.created_at),
        updated_at: String(p.updated_at ?? p.created_at),
      })),
    };
  } catch (err) {
    console.error("fetchForumTopic failed", err);
    return null;
  }
}
