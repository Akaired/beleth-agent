"use server";

/**
 * Forum writes. The webapp has no service-role client, so every write goes
 * through the cookie-bound anon client under RLS (db/migrations/0008_forum.sql):
 * `author_id`, `author_name` and `post_number` are stamped by BEFORE-INSERT
 * triggers, counters by AFTER-INSERT triggers, and a topic + its first post are
 * created atomically by the `beleth_forum_create_topic` SECURITY DEFINER
 * function. Creating a topic or replying requires a signed-in account; browsing
 * does not.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { htmlToText, sanitizeForumHtml } from "@/lib/forum/sanitize";
import type { ForumActionState } from "@/lib/forum/types";

const TITLE_MIN = 3;
const TITLE_MAX = 120;
const BODY_MAX = 100000;

/**
 * Sanitise the editor's HTML and reject a visually empty body. Returns the
 * clean HTML on success, or an error message.
 */
function cleanBody(raw: string): { html: string } | { error: string } {
  const html = sanitizeForumHtml(raw);
  const hasEmbed = /<(img|iframe)\b|class="tv-embed"/i.test(html);
  if (htmlToText(html).length < 1 && !hasEmbed) {
    return { error: "Write something first." };
  }
  if (html.length > BODY_MAX) return { error: "That is too long." };
  return { html };
}

export async function createTopicAction(
  _prev: ForumActionState,
  formData: FormData,
): Promise<ForumActionState> {
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login?next=/forum/new");

  const categorySlug = String(formData.get("category") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();

  if (!categorySlug) return { error: "Pick a category." };
  if (title.length < TITLE_MIN || title.length > TITLE_MAX)
    return { error: `Title must be ${TITLE_MIN}–${TITLE_MAX} characters.` };

  const cleaned = cleanBody(String(formData.get("body") ?? ""));
  if ("error" in cleaned) return { error: cleaned.error };

  const supabase = await createClient();
  const { data: cat } = await supabase
    .from("forum_categories")
    .select("id")
    .eq("slug", categorySlug)
    .maybeSingle();
  if (!cat) return { error: "Unknown category." };

  const { data, error } = await supabase.rpc("beleth_forum_create_topic", {
    p_category_id: (cat as { id: string }).id,
    p_title: title,
    p_body: cleaned.html,
  });
  if (error || !data) {
    return { error: error?.message ?? "Could not create the topic." };
  }

  const created = (Array.isArray(data) ? data[0] : data) as { slug: string };
  revalidatePath("/forum");
  revalidatePath(`/forum/c/${categorySlug}`);
  redirect(`/forum/t/${created.slug}`);
}

export async function createReplyAction(
  _prev: ForumActionState,
  formData: FormData,
): Promise<ForumActionState> {
  const topicSlug = String(formData.get("slug") ?? "");
  const ctx = await getSessionContext();
  if (!ctx) redirect(`/login?next=/forum/t/${topicSlug}`);

  const topicId = String(formData.get("topic_id") ?? "");
  if (!topicId) return { error: "Missing topic." };

  const cleaned = cleanBody(String(formData.get("body") ?? ""));
  if ("error" in cleaned) return { error: cleaned.error };

  const supabase = await createClient();
  const { data: topic } = await supabase
    .from("forum_topics")
    .select("closed")
    .eq("id", topicId)
    .maybeSingle();
  if ((topic as { closed?: boolean } | null)?.closed) {
    return { error: "This topic is closed." };
  }

  const { error } = await supabase
    .from("forum_posts")
    .insert({ topic_id: topicId, body: cleaned.html });
  if (error) return { error: error.message };

  revalidatePath(`/forum/t/${topicSlug}`);
  return { error: null, ok: true };
}

export async function editPostAction(
  _prev: ForumActionState,
  formData: FormData,
): Promise<ForumActionState> {
  const slug = String(formData.get("slug") ?? "");
  const ctx = await getSessionContext();
  if (!ctx) redirect(`/login?next=/forum/t/${slug}`);

  const postId = String(formData.get("post_id") ?? "");
  if (!postId) return { error: "Missing post." };

  const cleaned = cleanBody(String(formData.get("body") ?? ""));
  if ("error" in cleaned) return { error: cleaned.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_forum_edit_post", {
    p_post_id: postId,
    p_body: cleaned.html,
  });
  if (error) return { error: error.message };

  revalidatePath(`/forum/t/${slug}`);
  return { error: null, ok: true };
}

/** Delete one of the caller's own replies. RLS + the RPC enforce ownership. */
export async function deletePostAction(formData: FormData): Promise<void> {
  const slug = String(formData.get("slug") ?? "");
  const ctx = await getSessionContext();
  if (!ctx) redirect(`/login?next=/forum/t/${slug}`);

  const postId = String(formData.get("post_id") ?? "");
  if (!postId) return;

  const supabase = await createClient();
  await supabase.rpc("beleth_forum_delete_post", { p_post_id: postId });
  revalidatePath(`/forum/t/${slug}`);
}

/** Delete one of the caller's own topics (cascades to every post in it). */
export async function deleteTopicAction(formData: FormData): Promise<void> {
  const categorySlug = String(formData.get("category_slug") ?? "");
  const ctx = await getSessionContext();
  if (!ctx) redirect("/login?next=/forum");

  const topicId = String(formData.get("topic_id") ?? "");
  if (!topicId) return;

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_forum_delete_topic", {
    p_topic_id: topicId,
  });
  if (error) return; // stay on the topic page; the control shows nothing broke

  revalidatePath("/forum");
  if (categorySlug) revalidatePath(`/forum/c/${categorySlug}`);
  redirect(categorySlug ? `/forum/c/${categorySlug}` : "/forum");
}

/** Fire-and-forget view bump on topic open (see ViewPing). */
export async function bumpForumViewAction(topicId: string): Promise<void> {
  if (!topicId) return;
  try {
    const supabase = await createClient();
    await supabase.rpc("beleth_forum_bump_view", { p_topic_id: topicId });
  } catch {
    /* best effort — a missed view count is not worth surfacing */
  }
}
