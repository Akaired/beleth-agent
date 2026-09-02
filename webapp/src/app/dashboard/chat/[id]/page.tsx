import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isDemoAdmin, requireSession } from "@/lib/auth";
import { fetchBelethChatContext } from "@/lib/chat/context";
import { demoTurnsLeft } from "@/lib/chat/demo-allowance";
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

  const left = isDemoAdmin(ctx.role) ? await demoTurnsLeft() : null;

  return (
    <ChatView
      sessionId={id}
      initialMessages={rowsToDisplayMessages(rows)}
      scene={scene}
      mood={mood}
      demoTurnsLeft={left}
    />
  );
}
