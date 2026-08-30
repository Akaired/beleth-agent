/**
 * Data access for "Chat with Beleth". All reads/writes go through the
 * authenticated SSR Supabase client, so RLS (db/migrations/0006) scopes every
 * row to the signed-in user automatically.
 */
import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { ApiMessage } from "@/lib/chat/aiml";
import type {
  ChatDisplayMessage,
  ChatMessageRow,
  ChatRating,
  ChatRole,
  ChatSessionRow,
  ChatSessionSummary,
} from "@/lib/chat/types";

const MSG_COLS =
  "id,session_id,role,content,tool_calls,tool_call_id,model,usage,rating,created_at";

/** Most recently active sessions for the current user — the sidebar list. */
export async function fetchRecentChatSessions(
  limit = 3,
): Promise<ChatSessionSummary[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("chat_sessions")
      .select("id,title,updated_at")
      .order("updated_at", { ascending: false })
      .limit(limit);
    return (data as ChatSessionSummary[] | null) ?? [];
  } catch {
    return [];
  }
}

/** Every session for the current user, with a message count — the list page. */
export async function fetchAllChatSessions(): Promise<ChatSessionSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("chat_sessions")
    .select("id,title,updated_at,chat_messages(count)")
    .order("updated_at", { ascending: false });

  return (
    (data as
      | Array<{
          id: string;
          title: string | null;
          updated_at: string;
          chat_messages: { count: number }[];
        }>
      | null) ?? []
  ).map((r) => ({
    id: r.id,
    title: r.title,
    updated_at: r.updated_at,
    messageCount: r.chat_messages?.[0]?.count ?? 0,
  }));
}

export async function fetchChatSession(
  id: string,
): Promise<ChatSessionRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("chat_sessions")
    .select("id,user_id,title,created_at,updated_at")
    .eq("id", id)
    .maybeSingle();
  return (data as ChatSessionRow | null) ?? null;
}

export async function fetchChatMessages(
  sessionId: string,
): Promise<ChatMessageRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("chat_messages")
    .select(MSG_COLS)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  return (data as ChatMessageRow[] | null) ?? [];
}

export async function createChatSession(
  userId: string,
  title: string,
): Promise<string> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_sessions")
    .insert({ user_id: userId, title })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`could not create chat session: ${error?.message}`);
  }
  return data.id as string;
}

type InsertMessage = {
  session_id: string;
  role: "user" | "assistant" | "tool";
  content: string;
  tool_calls?: unknown;
  tool_call_id?: string | null;
  model?: string | null;
  usage?: unknown;
};

export type InsertedMessage = { id: string; role: ChatRole; created_at: string };

export async function insertChatMessages(
  rows: InsertMessage[],
): Promise<InsertedMessage[]> {
  if (!rows.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("chat_messages")
    .insert(rows)
    .select("id,role,created_at");
  if (error) throw new Error(`could not persist messages: ${error.message}`);
  return (data as InsertedMessage[] | null) ?? [];
}

/** Bump updated_at so the session floats to the top of the sidebar list. */
export async function touchChatSession(id: string): Promise<void> {
  const supabase = await createClient();
  await supabase
    .from("chat_sessions")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id);
}

export async function deleteChatSession(id: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("chat_sessions").delete().eq("id", id);
  if (error) throw new Error(`could not delete chat: ${error.message}`);
}

/** Set / clear the thumbs on one assistant message. RLS scopes it to the owner. */
export async function setChatMessageRating(
  messageId: string,
  rating: ChatRating | null,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("chat_messages")
    .update({ rating })
    .eq("id", messageId);
  if (error) throw new Error(`could not save rating: ${error.message}`);
}

/**
 * Delete every message in `sessionId` at or after `fromCreatedAt` — used by the
 * edit flow to drop the last user turn and its reply before regenerating.
 */
export async function deleteChatMessagesFrom(
  sessionId: string,
  fromCreatedAt: string,
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("chat_messages")
    .delete()
    .eq("session_id", sessionId)
    .gte("created_at", fromCreatedAt);
  if (error) throw new Error(`could not trim messages: ${error.message}`);
}

// ── row <-> message conversions ───────────────────────────────────────────────

/** Stored rows -> the transcript the model needs as prior context. */
export function rowsToApiMessages(rows: ChatMessageRow[]): ApiMessage[] {
  return rows.map((r) => {
    if (r.role === "assistant") {
      return {
        role: "assistant" as const,
        content: r.content ?? "",
        ...(r.tool_calls && r.tool_calls.length
          ? { tool_calls: r.tool_calls }
          : {}),
      };
    }
    if (r.role === "tool") {
      return {
        role: "tool" as const,
        content: r.content ?? "",
        tool_call_id: r.tool_call_id ?? undefined,
      };
    }
    return { role: "user" as const, content: r.content ?? "" };
  });
}

/** Stored rows -> what the UI shows: user turns and non-empty assistant answers. */
export function rowsToDisplayMessages(
  rows: ChatMessageRow[],
): ChatDisplayMessage[] {
  return rows
    .filter(
      (r) =>
        (r.role === "user" || r.role === "assistant") &&
        (r.content?.trim().length ?? 0) > 0,
    )
    .map((r) => ({
      id: r.id,
      role: r.role as "user" | "assistant",
      content: r.content,
      created_at: r.created_at,
      rating: r.rating ?? null,
    }));
}
