"use client";

import { useState, useTransition } from "react";
import { deleteChatSessionAction } from "@/app/dashboard/chat/actions";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { IconTrash } from "@/components/icons";

export function DeleteChatButton({ id, title }: { id: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function confirm() {
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      await deleteChatSessionAction(fd);
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Delete chat: ${title}`}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-faint transition-colors hover:bg-hoverbg hover:text-down"
      >
        <IconTrash size={14} />
      </button>
      <ConfirmDialog
        open={open}
        title="Delete chat"
        body={
          <>
            <span className="text-txt">“{title}”</span> and its messages will be
            permanently removed. This can’t be undone.
          </>
        }
        confirmLabel="Delete"
        danger
        busy={pending}
        onConfirm={confirm}
        onCancel={() => !pending && setOpen(false)}
      />
    </>
  );
}
