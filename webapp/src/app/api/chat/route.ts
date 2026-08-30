/**
 * POST /api/chat — one turn of "Chat with Beleth".
 *
 * Body: { sessionId: string | null, message: string }
 * - sessionId null  -> a new session is created, titled from this message.
 * - sessionId given -> must belong to the caller (RLS + an explicit check).
 *
 * The handler runs Beleth's bounded tool-calling loop (read-only tools),
 * persists the user message and every row the turn produced, and returns the
 * new session id plus the assistant's answer. Any signed-in user may call it.
 */
import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ChatModelError, runBelethTurn } from "@/lib/chat/aiml";
import { fetchBelethChatContext } from "@/lib/chat/context";
import {
  createChatSession,
  fetchChatMessages,
  fetchChatSession,
  insertChatMessages,
  rowsToApiMessages,
  touchChatSession,
} from "@/lib/chat/queries";
import { deriveTitle } from "@/lib/chat/types";

const MAX_MESSAGE_CHARS = 2_000;
/** Bound a single conversation so a free model's quota is not open-ended. */
const MAX_MESSAGES_PER_SESSION = 80;

// The gpt-oss call (reasoning + tools) can take tens of seconds; the platform
// default would cut it off. 60s is the Hobby ceiling.
export const maxDuration = 60;

export async function POST(req: Request) {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  let body: { sessionId?: unknown; message?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request body." }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const sessionId =
    typeof body.sessionId === "string" && body.sessionId ? body.sessionId : null;

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

  // Resolve the session: verify ownership, or create a fresh one.
  let activeSessionId = sessionId;
  let priorHistory: ReturnType<typeof rowsToApiMessages> = [];

  if (activeSessionId) {
    const session = await fetchChatSession(activeSessionId);
    if (!session || session.user_id !== ctx.userId) {
      return NextResponse.json({ error: "Chat not found." }, { status: 404 });
    }
    const rows = await fetchChatMessages(activeSessionId);
    if (rows.length >= MAX_MESSAGES_PER_SESSION) {
      return NextResponse.json(
        { error: "This conversation is full — start a new chat." },
        { status: 409 },
      );
    }
    priorHistory = rowsToApiMessages(rows);
  } else {
    activeSessionId = await createChatSession(ctx.userId, deriveTitle(message));
  }

  // Run the turn.
  let turn;
  try {
    const { mood } = await fetchBelethChatContext();
    const supabase = await createClient();
    turn = await runBelethTurn({
      mood,
      history: priorHistory,
      userMessage: message,
      toolContext: { supabase },
    });
  } catch (err) {
    console.error("[chat] turn failed", err);
    // A brand-new session with no content is not worth keeping around.
    if (!sessionId && activeSessionId) {
      try {
        const s = await createClient();
        await s.from("chat_sessions").delete().eq("id", activeSessionId);
      } catch {
        /* best effort */
      }
    }
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

  // Persist: the user message, then every row the turn produced.
  const nowRows = [
    {
      session_id: activeSessionId,
      role: "user" as const,
      content: message,
    },
    ...turn.newMessages.map((m, i) => ({
      session_id: activeSessionId as string,
      role: m.role,
      content: m.content,
      tool_calls: m.tool_calls ?? null,
      tool_call_id: m.tool_call_id ?? null,
      // Stamp model + usage on the final assistant row only.
      model:
        m.role === "assistant" && i === turn.newMessages.length - 1
          ? turn.model
          : null,
      usage:
        m.role === "assistant" && i === turn.newMessages.length - 1
          ? turn.usage
          : null,
    })),
  ];

  let userMessageId: string | null = null;
  let assistantMessageId: string | null = null;
  try {
    const inserted = await insertChatMessages(nowRows);
    userMessageId = inserted.find((r) => r.role === "user")?.id ?? null;
    assistantMessageId =
      [...inserted].reverse().find((r) => r.role === "assistant")?.id ?? null;
    await touchChatSession(activeSessionId);
  } catch (err) {
    console.error("[chat] persistence failed", err);
    // The answer is still valid even if we failed to store it.
  }

  // Award chat XP for the user message (capped server-side per day). Best
  // effort — a failure here must never turn a good answer into an error.
  try {
    const s = await createClient();
    await s.rpc("beleth_award_chat_xp");
  } catch (err) {
    console.error("[chat] xp award failed", err);
  }

  return NextResponse.json({
    sessionId: activeSessionId,
    answer: turn.answer,
    userMessageId,
    assistantMessageId,
  });
}
