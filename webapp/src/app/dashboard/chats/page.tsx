import Link from "next/link";
import type { Metadata } from "next";
import { isDemoAdmin, requireSession } from "@/lib/auth";
import { fetchAllChatSessions } from "@/lib/chat/queries";
import { timeAgo } from "@/components/dashboard/ui";
import { DeleteChatButton } from "@/components/dashboard/delete-chat-button";
import { IconChat, IconPlus } from "@/components/icons";

export const metadata: Metadata = { title: "All chats — Beleth" };

export default async function ChatsPage() {
  const ctx = await requireSession();
  // The demo login is shared: one visitor must not discard another's
  // transcript (the database refuses it too — see 0030).
  const canDelete = !isDemoAdmin(ctx.role);
  const sessions = await fetchAllChatSessions();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="flex items-center gap-2 text-[18px] font-light">
          <IconChat size={17} weight="bold" className="text-acc" />
          All chats
        </h1>
        <Link
          href="/dashboard/chat"
          className="flex items-center gap-1.5 rounded-md bg-acc/15 px-3 py-1.5 text-[12px] text-acc transition-colors hover:bg-acc/25"
        >
          <IconPlus size={13} weight="bold" /> New chat
        </Link>
      </div>

      {sessions.length === 0 ? (
        <div className="border border-line rounded-md bg-panel p-8 text-center">
          <p className="text-[13px] text-sec">
            No conversations yet.{" "}
            <Link href="/dashboard/chat" className="text-acc hover:underline">
              Start one
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="border border-line rounded-md bg-panel divide-y divide-rowline">
          {sessions.map((s) => {
            const title = s.title?.trim() || "Untitled chat";
            return (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3 hover:bg-hoverbg">
                <Link href={`/dashboard/chat/${s.id}`} className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] text-txt">{title}</span>
                  <span className="font-mono text-[10.5px] text-dim">
                    {s.messageCount ?? 0} message{(s.messageCount ?? 0) === 1 ? "" : "s"} ·{" "}
                    {timeAgo(s.updated_at)}
                  </span>
                </Link>
                {canDelete && <DeleteChatButton id={s.id} title={title} />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
