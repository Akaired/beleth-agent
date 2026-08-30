import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { fetchBelethChatContext } from "@/lib/chat/context";
import {
  fetchChatMessages,
  fetchChatSession,
  rowsToDisplayMessages,
} from "@/lib/chat/queries";
import { ChatView } from "@/components/dashboard/chat-view";

export const metadata: Metadata = { title: "Chat with Beleth" };

export default async function ChatSessionPage({
  params,
}: PageProps<"/dashboard/chat/[id]">) {
  const ctx = await requireSession();
  const { id } = await params;

  const session = await fetchChatSession(id);
  // RLS already scopes the read to the owner; the explicit check is belt-and-braces.
  if (!session || session.user_id !== ctx.userId) notFound();

  const [rows, { mood, scene }] = await Promise.all([
    fetchChatMessages(id),
    fetchBelethChatContext(),
  ]);

  return (
    <ChatView
      sessionId={id}
      initialMessages={rowsToDisplayMessages(rows)}
      scene={scene}
      mood={mood}
    />
  );
}
