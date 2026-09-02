"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AUTHOR_NAME_MAX } from "@/lib/forum/limits";

const LAST_ALIAS_KEY = "beleth.demo.forumAlias";

/** Read the alias used last time, so a judge does not retype it every post. */
export function readLastDemoAlias(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(LAST_ALIAS_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberDemoAlias(value: string): void {
  try {
    window.sessionStorage.setItem(LAST_ALIAS_KEY, value);
  } catch {
    /* private mode — not worth surfacing */
  }
}

/**
 * Blocking, non-dismissable modal shown to the shared demo account every time
 * it posts on the forum. There is deliberately NO close button, NO Escape, NO
 * backdrop dismissal — the only way forward is to enter a name (posted as the
 * author, always marked "(demo)" server-side) or to cancel the post outright.
 * Everything underneath is covered and inert while it is open.
 */
export function DemoNameDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const [value, setValue] = useState("");
  const [prevOpen, setPrevOpen] = useState(open);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setValue(readLastDemoAlias());
  }

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    // Swallow Escape so the browser / parent never treats it as a dismissal.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener("keydown", onKey, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  const trimmed = value.replace(/\s+/g, " ").trim().slice(0, 40);

  const submit = () => {
    if (trimmed.length < 2) return;
    rememberDemoAlias(trimmed);
    onConfirm(trimmed);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a name to post with"
    >
      <div className="w-full max-w-sm rounded-lg border border-line bg-panel shadow-2xl">
        <div className="px-5 pt-5 pb-4">
          <h2 className="text-[14px] font-medium text-txt">
            Post as&hellip;
          </h2>
          <p className="mt-2 text-[12px] leading-relaxed text-sec">
            You are signed in to the shared demo account. Pick a name for this
            post &mdash; it will appear as the author, marked{" "}
            <span className="font-mono text-dim">(demo)</span>. You can&rsquo;t
            change anything else on this account.
          </p>
          <label
            htmlFor={fieldId}
            className="mt-4 block font-mono text-[10px] uppercase tracking-[0.08em] text-sec"
          >
            Display name
          </label>
          <input
            ref={inputRef}
            id={fieldId}
            type="text"
            value={value}
            maxLength={AUTHOR_NAME_MAX}
            placeholder="e.g. Alex"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            className="mt-1.5 w-full rounded border border-inputline bg-inset px-3 py-2 text-[13px] text-txt outline-none transition-colors focus:border-hoverline"
          />
          <p className="mt-1.5 text-[11px] text-dim">
            Preview:{" "}
            <span className="text-sec">
              {(trimmed.length >= 2 ? trimmed : "Guest") + " (demo)"}
            </span>
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-[12px] text-sec transition-colors hover:text-txt"
          >
            Cancel post
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={trimmed.length < 2}
            className="rounded border border-emphline bg-acc/15 px-3 py-1.5 text-[12px] font-medium text-acc transition-colors hover:bg-acc/25 disabled:opacity-50"
          >
            Post
          </button>
        </div>
      </div>
    </div>
  );
}
