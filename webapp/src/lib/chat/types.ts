/**
 * Shared types for "Chat with Beleth". Safe to import from Client Components —
 * no server-only dependency.
 */

/** A stored transcript row (public.chat_messages). */
export type ChatRole = "user" | "assistant" | "tool";

/** Thumbs on an assistant answer (0007). */
export type ChatRating = "up" | "down";

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessageRow = {
  id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  tool_calls: ToolCall[] | null;
  tool_call_id: string | null;
  model: string | null;
  usage: Record<string, number> | null;
  rating: ChatRating | null;
  created_at: string;
};

export type ChatSessionRow = {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

/** What the sidebar and the chat list need per session. */
export type ChatSessionSummary = {
  id: string;
  title: string | null;
  updated_at: string;
  messageCount?: number;
};

/** A message as rendered in the UI — user turns and assistant answers only. */
export type ChatDisplayMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  rating?: ChatRating | null;
};

/** POST /api/chat request + response. */
export type ChatRequest = { sessionId: string | null; message: string };
export type ChatResponse = {
  sessionId: string;
  answer: string;
  userMessageId: string | null;
  assistantMessageId: string | null;
  /** Turns the shared demo login has left today on this browser; null otherwise. */
  demoTurnsLeft?: number | null;
};

/** POST /api/chat/edit — replace the last user message and regenerate. */
export type ChatEditRequest = {
  sessionId: string;
  messageId: string;
  message: string;
};
export type ChatEditResponse = {
  answer: string;
  userMessageId: string | null;
  assistantMessageId: string | null;
};

/** Derive a session title from the first user message. */
export function deriveTitle(firstMessage: string): string {
  const clean = firstMessage.trim().replace(/\s+/g, " ");
  if (clean.length <= 60) return clean || "New chat";
  return `${clean.slice(0, 57)}…`;
}
