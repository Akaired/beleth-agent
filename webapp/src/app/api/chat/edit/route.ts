/**
 * POST /api/chat/edit — edit the last user message and regenerate.
 *
 * Body: { sessionId, messageId, message }
 * `messageId` must be the LAST user message in the session. The handler drops
 * that message and Beleth's reply to it, replays the conversation up to that
 * point with the new text, persists the fresh turn, and returns the new answer.
 * Any signed-in user may call it, on their own sessions only.
 */
import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ChatModelError, runBelethTurn } from "@/lib/chat/aiml";
import { fetchBelethChatContext } from "@/lib/chat/context";
import {
  deleteChatMessagesFrom,
  fetchChatMessages,
  fetchChatSession,
  insertChatMessages,
  rowsToApiMessages,
  touchChatSession,
} from "@/lib/chat/queries";

const MAX_MESSAGE_CHARS = 2_000;

// The gpt-oss call (reasoning + tools) can take tens of seconds.
export const maxDuration = 60;

export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { sessionId?: unknown; messageId?: unknown; message?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request body." }, { status: 400 });
  }

  const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
  const messageId = typeof body.messageId === "string" ? body.messageId : "";
  const message = typeof body.message === "string" ? body.message.trim() : "";

  if (!sessionId || !messageId) {
    return NextResponse.json({ error: "Missing ids." }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "Message is empty." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return NextResponse.json(
      { error: `Message is too long (max ${MAX_MESSAGE_CHARS} characters).` },
      { status: 400 },
    );
  }
  if (!process.env.AIML_API_KEY) {
    return NextResponse.json(
      { error: "Chat is not configured on this deployment yet." },
      { status: 503 },
    );
  }

  const session = await fetchChatSession(sessionId);
  if (!session || session.user_id !== ctx.userId) {
    return NextResponse.json({ error: "Chat not found." }, { status: 404 });
  }

  const rows = await fetchChatMessages(sessionId);
  const edited = rows.find((r) => r.id === messageId);
  if (!edited || edited.role !== "user") {
    return NextResponse.json({ error: "Message not found." }, { status: 404 });
  }
  const lastUserRow = [...rows].reverse().find((r) => r.role === "user");
  if (!lastUserRow || lastUserRow.id !== messageId) {
    return NextResponse.json(
      { error: "Only the last message can be edited." },
      { status: 409 },
    );
  }

  const priorRows = rows.filter((r) => r.created_at < edited.created_at);
  const history = rowsToApiMessages(priorRows);

  let turn;
  try {
    const { mood } = await fetchBelethChatContext();
    const supabase = await createClient();
    turn = await runBelethTurn({
      mood,
      history,
      userMessage: message,
      toolContext: { supabase },
    });
  } catch (err) {
    console.error("[chat/edit] turn failed", err);
    const known = err instanceof ChatModelError ? err : null;
    return NextResponse.json(
      {
        error:
          known?.userMessage ??
          "Beleth could not reach the model. Try again in a moment.",
      },
      { status: known?.status ?? 502 },
    );
  }

  // The model call succeeded — now swap the old tail for the new one.
  let userMessageId: string | null = null;
  let assistantMessageId: string | null = null;
  try {
    await deleteChatMessagesFrom(sessionId, edited.created_at);
    const inserted = await insertChatMessages([
      { session_id: sessionId, role: "user", content: message },
      ...turn.newMessages.map((m, i) => ({
        session_id: sessionId,
        role: m.role,
        content: m.content,
        tool_calls: m.tool_calls ?? null,
        tool_call_id: m.tool_call_id ?? null,
        model:
          m.role === "assistant" && i === turn.newMessages.length - 1
            ? turn.model
            : null,
        usage:
          m.role === "assistant" && i === turn.newMessages.length - 1
            ? turn.usage
            : null,
      })),
    ]);
    userMessageId = inserted.find((r) => r.role === "user")?.id ?? null;
    assistantMessageId =
      [...inserted].reverse().find((r) => r.role === "assistant")?.id ?? null;
    await touchChatSession(sessionId);
  } catch (err) {
    console.error("[chat/edit] persistence failed", err);
  }

  return NextResponse.json({ answer: turn.answer, userMessageId, assistantMessageId });
}
