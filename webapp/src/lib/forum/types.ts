/**
 * Client-safe forum types. No `server-only` import — these cross into Client
 * Components (composer, new-topic form). The server query layer lives in
 * `src/lib/forum/queries.ts`; the shared token set is db/migrations/0008_forum.sql.
 */

export type ForumCategory = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  color: string;
  position: number;
};

export type ForumCategoryWithCount = ForumCategory & {
  topic_count: number;
};

/** Minimal topic shape for the sidebar's "recent" list under Forum. */
export type ForumRecentTopic = { id: string; slug: string; title: string };

/** A row in the Discourse-style topic list (category + author flattened in). */
export type ForumTopicListItem = {
  id: string;
  slug: string;
  title: string;
  author_name: string;
  created_at: string;
  last_posted_at: string;
  reply_count: number;
  view_count: number;
  category_slug: string;
  category_name: string;
  category_color: string;
};

export type ForumPost = {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  post_number: number;
  created_at: string;
  updated_at: string;
};

export type ForumTopicDetail = {
  topic: {
    id: string;
    slug: string;
    title: string;
    author_id: string;
    author_name: string;
    created_at: string;
    last_posted_at: string;
    reply_count: number;
    view_count: number;
  };
  category: { slug: string; name: string; color: string };
  posts: ForumPost[];
};

/** Result of a create-topic / create-reply server action, for `useActionState`. */
export type ForumActionState = { error: string | null; ok?: boolean };
