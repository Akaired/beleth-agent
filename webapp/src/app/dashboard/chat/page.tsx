import type { Metadata } from "next";
import { isDemoAdmin, requireSession } from "@/lib/auth";
import { fetchBelethChatContext } from "@/lib/chat/context";
import { demoTurnsLeft } from "@/lib/chat/demo-allowance";
import { ChatView } from "@/components/dashboard/chat-view";

export const metadata: Metadata = { title: "Chat with Beleth" };

// A fresh conversation. The session row is created lazily on the first message
// (POST /api/chat), which then swaps the URL to /dashboard/chat/<id>.
export default async function NewChatPage() {
  const ctx = await requireSession();
  const { mood, scene } = await fetchBelethChatContext();
  // The shared demo login answers a few questions per browser per day.
  const left = isDemoAdmin(ctx.role) ? await demoTurnsLeft() : null;

  return (
    <ChatView
      sessionId={null}
      initialMessages={[]}
      scene={scene}
      mood={mood}
      demoTurnsLeft={left}
    />
  );
}
