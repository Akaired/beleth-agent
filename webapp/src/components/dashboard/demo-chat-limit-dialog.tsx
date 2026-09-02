"use client";

import { useEffect } from "react";
import Link from "next/link";
import { DEMO_DAILY_MESSAGES } from "@/lib/chat/demo-allowance-limits";

/**
 * Shown when a visitor on the shared demo account has spent that browser's
 * daily chat allowance. Dismissable — the rest of the demo stays usable, this
 * is an invitation rather than a wall.
 */
export function DemoChatLimitDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Demo chat limit reached"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-5 pb-4">
          <h2 className="text-[14px] font-medium text-txt">
            That&rsquo;s the demo&rsquo;s {DEMO_DAILY_MESSAGES} questions
          </h2>
          <p className="mt-2 text-[12px] leading-relaxed text-sec">
            The demo account is shared by everyone who lands here, and the model
            behind Beleth is on a free plan &mdash; so it answers a few questions
            per visitor, per day. Register a real account and the limit goes
            away, along with your own chat history.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-[12px] text-sec transition-colors hover:text-txt"
          >
            Keep looking around
          </button>
          <Link
            href="/login?mode=signup"
            className="rounded border border-emphline bg-acc/15 px-3 py-1.5 text-[12px] font-medium text-acc transition-colors hover:bg-acc/25"
          >
            Create a free account
          </Link>
        </div>
      </div>
    </div>
  );
}
