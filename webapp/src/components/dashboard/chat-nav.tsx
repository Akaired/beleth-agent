"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ChatSessionSummary } from "@/lib/chat/types";
import { deleteChatSessionAction } from "@/app/dashboard/chat/actions";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { IconChat, IconChats, IconPlus, IconTrash } from "@/components/icons";

type IconProps = { size?: number; weight?: "regular" | "bold" | "fill"; className?: string };

function Row({
  href,
  label,
  Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  Icon: (p: IconProps) => React.ReactNode;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-2.5 border-l-2 py-[5px] pl-2.5 pr-3 text-[12.5px] transition-colors ${
        active
          ? "border-acc bg-hoverbg text-txt"
          : "border-transparent text-sec hover:text-txt"
      }`}
    >
      <Icon
        size={15}
        weight={active ? "bold" : "regular"}
        className={active ? "text-acc" : "text-dim"}
      />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/** One of the three recent conversations — indented under the section, with a
 *  hover-revealed delete button. */
function RecentRow({
  chat,
  active,
  onNavigate,
  canDelete = true,
}: {
  chat: ChatSessionSummary;
  active: boolean;
  onNavigate?: () => void;
  canDelete?: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const title = chat.title?.trim() || "Untitled chat";

  function onDelete() {
    const fd = new FormData();
    fd.set("id", chat.id);
    startTransition(async () => {
      await deleteChatSessionAction(fd);
      setConfirming(false);
      if (active) {
        // A hard navigation, not router.push: after a send() the router's
        // route can be desynced from the URL (we use history.replaceState to
        // avoid a remount), so router.push("/dashboard/chat") may be a no-op
        // and leave the just-deleted chat's messages on screen.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/dashboard/chat");
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div
      className={`group flex items-center border-l-2 transition-colors ${
        active ? "border-acc bg-hoverbg" : "border-transparent"
      }`}
    >
      <Link
        href={`/dashboard/chat/${chat.id}`}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={`flex min-w-0 flex-1 items-center gap-2 py-[3px] pl-7 pr-1 text-[12px] transition-colors ${
          active ? "text-txt" : "text-sec group-hover:text-txt"
        }`}
      >
        <IconChat
          size={13}
          weight={active ? "bold" : "regular"}
          className={active ? "text-acc" : "text-dim"}
        />
        <span className="truncate">{title}</span>
      </Link>
      {canDelete && (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={busy}
          aria-label={`Delete chat: ${title}`}
          className="mr-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-faint opacity-0 transition-opacity hover:bg-hoverbg hover:text-down focus:opacity-100 group-hover:opacity-100 disabled:opacity-40"
        >
          <IconTrash size={12} />
        </button>
      )}
      <ConfirmDialog
        open={confirming}
        title="Delete chat"
        body={
          <>
            <span className="text-txt">“{title}”</span> and its messages will be
            permanently removed. This can’t be undone.
          </>
        }
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={onDelete}
        onCancel={() => !busy && setConfirming(false)}
      />
    </div>
  );
}

/**
 * The "Chat" sidebar section: a New-chat entry, an All-chats link, and the
 * three most recently active conversations (indented, each deletable
 * except on the shared demo login).
 * Rendered inside DashboardChrome, between Live and Records.
 */
export function ChatNav({
  recentChats,
  onNavigate,
  canDelete = true,
}: {
  recentChats: ChatSessionSummary[];
  onNavigate?: () => void;
  /** False on the shared demo login, which may read a transcript but not
   *  discard one another visitor may still be reading (see 0030). */
  canDelete?: boolean;
}) {
  const pathname = usePathname();

  return (
    <div className="pt-2 pb-0.5">
      <div className="px-3 pb-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-faint">
        Chat
      </div>

      <Row
        href="/dashboard/chat"
        label="New chat"
        Icon={IconPlus}
        active={pathname === "/dashboard/chat"}
        onNavigate={onNavigate}
      />
      <Row
        href="/dashboard/chats"
        label="All chats"
        Icon={IconChats}
        active={pathname === "/dashboard/chats"}
        onNavigate={onNavigate}
      />

      {recentChats.map((c) => (
        <RecentRow
          key={c.id}
          chat={c}
          active={pathname === `/dashboard/chat/${c.id}`}
          onNavigate={onNavigate}
          canDelete={canDelete}
        />
      ))}
    </div>
  );
}
