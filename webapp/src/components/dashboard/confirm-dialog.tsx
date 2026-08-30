"use client";

import { useEffect, useRef } from "react";

/**
 * A small modal confirm dialog — replaces window.confirm() for destructive
 * actions in the dashboard. Backdrop click and Escape cancel; the confirm
 * button takes focus on open; body scroll is locked while it is shown.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel"
        onClick={() => !busy && onCancel()}
        className="absolute inset-0 bg-black/60"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-sm rounded-lg border border-line bg-panel shadow-2xl"
      >
        <div className="px-5 pt-4 pb-3">
          <h2 className="text-[14px] font-medium text-txt">{title}</h2>
          {body && (
            <div className="mt-1.5 text-[12.5px] leading-relaxed text-sec">
              {body}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded px-3 py-1.5 text-[12px] text-sec transition-colors hover:text-txt disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50 ${
              danger
                ? "border-killline bg-blocked/25 text-down hover:bg-blocked/40"
                : "border-emphline bg-acc/15 text-acc hover:bg-acc/25"
            }`}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
