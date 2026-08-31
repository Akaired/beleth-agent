"use client";

import { useRef, useState, useTransition } from "react";
import { createReplyAction } from "@/lib/forum/actions";
import { RichEditor } from "@/components/forum/rich-editor";
import { DemoNameDialog } from "@/components/forum/demo-name-dialog";

export function ReplyComposer({
  topicId,
  slug,
  isDemo = false,
}: {
  topicId: string;
  slug: string;
  isDemo?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [pending, start] = useTransition();
  const [askName, setAskName] = useState(false);
  const pendingData = useRef<FormData | null>(null);

  function send(fd: FormData) {
    start(async () => {
      const res = await createReplyAction({ error: null }, fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setError(null);
      setResetKey((k) => k + 1); // remount the editor empty
    });
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (isDemo) {
      // Every demo reply is gated through the name modal.
      pendingData.current = fd;
      setAskName(true);
      return;
    }
    send(fd);
  }

  return (
    <>
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 rounded-md border border-line bg-panel p-4"
      >
        <input type="hidden" name="topic_id" value={topicId} />
        <input type="hidden" name="slug" value={slug} />
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-sec">
          Reply
        </span>
        <RichEditor
          name="body"
          placeholder="Write a reply…"
          minHeight={140}
          resetKey={resetKey}
        />
        {error && <p className="text-[11.5px] text-down">{error}</p>}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-acc/15 px-3.5 py-1.5 text-[12px] text-acc transition-colors hover:bg-acc/25 disabled:opacity-50"
          >
            {pending ? "Posting…" : "Post reply"}
          </button>
        </div>
      </form>

      {isDemo && (
        <DemoNameDialog
          open={askName}
          onConfirm={(name) => {
            const fd = pendingData.current;
            pendingData.current = null;
            setAskName(false);
            if (!fd) return;
            fd.set("author_name", name);
            send(fd);
          }}
          onCancel={() => {
            pendingData.current = null;
            setAskName(false);
          }}
        />
      )}
    </>
  );
}
