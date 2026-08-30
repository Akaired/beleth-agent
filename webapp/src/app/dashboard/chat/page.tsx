import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { fetchBelethChatContext } from "@/lib/chat/context";
import { ChatView } from "@/components/dashboard/chat-view";

export const metadata: Metadata = { title: "Chat with Beleth" };

// A fresh conversation. The session row is created lazily on the first message
// (POST /api/chat), which then swaps the URL to /dashboard/chat/<id>.
export default async function NewChatPage() {
  await requireSession();
  const { mood, scene } = await fetchBelethChatContext();

  return (
    <ChatView
      sessionId={null}
      initialMessages={[]}
      scene={scene}
      mood={mood}
    />
  );
}
