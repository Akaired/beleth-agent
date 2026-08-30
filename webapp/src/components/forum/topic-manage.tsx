"use client";

import { useState, useTransition } from "react";
import { deleteTopicAction } from "@/lib/forum/actions";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { IconTrash } from "@/components/icons";

/** "Delete topic" control, shown to the topic's author on the topic page. */
export function TopicManage({
  topicId,
  categorySlug,
  title,
}: {
  topicId: string;
  categorySlug: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function confirm() {
    const fd = new FormData();
    fd.set("topic_id", topicId);
    fd.set("category_slug", categorySlug);
    start(async () => {
      await deleteTopicAction(fd);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex shrink-0 items-center gap-1.5 rounded border border-line px-2.5 py-1 text-[11.5px] text-dim transition-colors hover:border-killline hover:text-down"
      >
        <IconTrash size={13} />
        Delete topic
      </button>
      <ConfirmDialog
        open={open}
        title="Delete topic"
        body={
          <>
            <span className="text-txt">“{title}”</span> and every reply will be
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
