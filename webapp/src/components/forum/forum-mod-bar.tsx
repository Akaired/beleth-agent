"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  deleteTopicAction,
  updateTopicAction,
} from "@/app/dashboard/admin/forum/actions";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import {
  IconLock,
  IconLockOpen,
  IconPin,
  IconTrash,
  IconUnpin,
  IconWarning,
} from "@/components/icons";

/**
 * Master-admin quick moderation, shown at the top of a topic page. Full
 * management (move between categories, rename, per-reply delete) lives in
 * /dashboard/admin/forum.
 */
export function ForumModBar({
  topicId,
  categorySlug,
  pinned,
  closed,
}: {
  topicId: string;
  categorySlug: string;
  pinned: boolean;
  closed: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Action failed.");
      else router.refresh();
    });
  }

  const btn =
    "flex items-center gap-1.5 rounded border border-line px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors disabled:opacity-40";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-panel px-3 py-2">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
        Moderate
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => updateTopicAction(topicId, { pinned: !pinned }))}
        className={`${btn} ${
          pinned ? "text-acc" : "text-sec hover:text-txt hover:border-hoverline"
        }`}
      >
        {pinned ? <IconUnpin size={12} /> : <IconPin size={12} />}
        {pinned ? "Unpin" : "Pin"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(() => updateTopicAction(topicId, { closed: !closed }))}
        className={`${btn} ${
          closed ? "text-acc" : "text-sec hover:text-txt hover:border-hoverline"
        }`}
      >
        {closed ? <IconLockOpen size={12} /> : <IconLock size={12} />}
        {closed ? "Reopen" : "Close"}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => setConfirmOpen(true)}
        className={`${btn} text-dim hover:border-killline hover:text-down`}
      >
        <IconTrash size={12} />
        Delete
      </button>
      {error && (
        <span className="flex items-center gap-1 font-mono text-[10px] text-down">
          <IconWarning size={11} /> {error}
        </span>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Delete topic"
        body="This topic and every reply will be permanently removed. This can’t be undone."
        confirmLabel="Delete"
        danger
        busy={pending}
        onConfirm={() =>
          start(async () => {
            const res = await deleteTopicAction(topicId);
            if (res.ok) router.push(`/forum/c/${categorySlug}`);
            else {
              setError(res.error ?? "Action failed.");
              setConfirmOpen(false);
            }
          })
        }
        onCancel={() => !pending && setConfirmOpen(false)}
      />
    </div>
  );
}
