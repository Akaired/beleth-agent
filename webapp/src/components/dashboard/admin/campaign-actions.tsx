"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  sendBroadcastAction,
  deleteBroadcastAction,
} from "@/app/dashboard/admin/email/actions";
import { IconWarning, IconEnvelope, IconTrash } from "@/components/icons";

/**
 * Send / schedule / delete a draft broadcast. Sending is an outbound,
 * irreversible fan-out, so it is gated three ways: an armed state, a
 * type-the-name confirmation, and a server action that re-checks the role.
 */
export function CampaignActions({
  id,
  name,
  status,
  recipientLabel,
}: {
  id: string;
  name: string;
  status: string;
  recipientLabel: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<null | "send" | "delete">(null);
  const [confirmText, setConfirmText] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sendable = status === "draft" || status === "scheduled";
  const nameMatches = confirmText.trim() === name.trim();

  function reset() {
    setMode(null);
    setConfirmText("");
    setError(null);
  }

  function doSend() {
    setError(null);
    startTransition(async () => {
      const res = await sendBroadcastAction(id, scheduledAt || undefined);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      reset();
      router.refresh();
    });
  }

  function doDelete() {
    setError(null);
    startTransition(async () => {
      const res = await deleteBroadcastAction(id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push("/dashboard/admin/email/campaigns");
    });
  }

  const btn =
    "rounded border px-3 py-1.5 font-mono text-[12px] uppercase tracking-[0.06em] transition-colors disabled:opacity-50";

  if (mode === null) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {sendable && (
            <button
              type="button"
              onClick={() => setMode("send")}
              className={`${btn} border-emphline text-acc hover:bg-acc/10`}
            >
              <span className="flex items-center gap-1.5">
                <IconEnvelope size={13} weight="bold" /> Send campaign
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setMode("delete")}
            className={`${btn} border-killline text-down hover:bg-down/10`}
          >
            <span className="flex items-center gap-1.5">
              <IconTrash size={13} weight="bold" /> Delete
            </span>
          </button>
        </div>
        {!sendable && status === "sent" && (
          <p className="text-[11px] text-sec">This campaign has already been sent.</p>
        )}
      </div>
    );
  }

  if (mode === "delete") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[12px] text-sec">
          Delete <span className="text-txt">{name}</span> permanently? This can&apos;t be undone.
        </p>
        <div className="flex items-center gap-2">
          <button type="button" onClick={doDelete} disabled={pending} className={`${btn} border-killline bg-down/15 text-down hover:bg-down/25`}>
            {pending ? "Deleting…" : "Confirm delete"}
          </button>
          <button type="button" onClick={reset} disabled={pending} className={`${btn} border-line text-sec hover:text-txt`}>
            Cancel
          </button>
        </div>
        {error && (
          <p className="flex items-start gap-2 font-mono text-[11px] text-down">
            <IconWarning size={13} className="mt-px shrink-0" />
            {error}
          </p>
        )}
      </div>
    );
  }

  // mode === "send"
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded border border-killline/60 bg-down/5 px-3 py-2.5 text-[12px] text-sec leading-relaxed">
        This sends <span className="text-txt">{name}</span> to{" "}
        <span className="text-txt">{recipientLabel}</span>. Recipients get the mail
        immediately unless you set a schedule. There is no recall.
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
          Schedule (optional)
        </span>
        <input
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          className="w-fit rounded border border-inputline bg-inset px-3 py-1.5 text-[13px] text-txt focus:border-acc focus:outline-none"
        />
        <span className="text-[11px] text-sec">Leave empty to send now.</span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
          Type the campaign name to confirm
        </span>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder={name}
          className="rounded border border-inputline bg-inset px-3 py-1.5 text-[13px] text-txt focus:border-acc focus:outline-none"
        />
      </label>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={doSend}
          disabled={pending || !nameMatches}
          className={`${btn} border-emphline bg-acc/15 text-acc hover:bg-acc/25`}
        >
          {pending ? "Sending…" : scheduledAt ? "Confirm schedule" : "Confirm send"}
        </button>
        <button type="button" onClick={reset} disabled={pending} className={`${btn} border-line text-sec hover:text-txt`}>
          Cancel
        </button>
      </div>

      {error && (
        <p className="flex items-start gap-2 font-mono text-[11px] text-down">
          <IconWarning size={13} className="mt-px shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
