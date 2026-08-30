"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Centered modal that collects a single value (used for the editor's Link and
 * Video URL entry, replacing Quill's cramped inline tooltip). Backdrop click and
 * Escape cancel; the input takes focus on open; body scroll is locked while
 * shown. Same visual shell as ConfirmDialog.
 */
export function PromptDialog({
  open,
  title,
  label,
  placeholder,
  initialValue = "",
  confirmLabel = "Insert",
  inputType = "text",
  hint,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  inputType?: "text" | "url";
  hint?: React.ReactNode;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);
  const [prevOpen, setPrevOpen] = useState(open);
  const fieldId = useId();

  // Reset the field each time the dialog opens (it stays mounted between opens).
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setValue(initialValue);
  }

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onCancel]);

  if (!open) return null;

  const submit = () => {
    const v = value.trim();
    if (v) onConfirm(v);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel"
        onClick={onCancel}
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
          <label
            htmlFor={fieldId}
            className="mt-3 block font-mono text-[10px] uppercase tracking-[0.08em] text-sec"
          >
            {label}
          </label>
          <input
            ref={inputRef}
            id={fieldId}
            type={inputType}
            value={value}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            className="mt-1.5 w-full rounded border border-inputline bg-inset px-3 py-2 text-[13px] text-txt outline-none transition-colors focus:border-hoverline"
          />
          {hint && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-dim">{hint}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-[12px] text-sec transition-colors hover:text-txt"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={value.trim() === ""}
            className="rounded border border-emphline bg-acc/15 px-3 py-1.5 text-[12px] font-medium text-acc transition-colors hover:bg-acc/25 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
