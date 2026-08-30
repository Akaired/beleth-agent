"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DocCategory } from "@/lib/docs/types";
import {
  deleteCategoryAction,
  saveCategoryAction,
} from "@/app/dashboard/admin/docs/actions";
import { IconCheck, IconClose, IconPlus, IconTrash, IconWarning } from "@/components/icons";

export function DocsCategoriesModal({
  open,
  onClose,
  categories,
  pageCountBySlug,
}: {
  open: boolean;
  onClose: () => void;
  categories: DocCategory[];
  pageCountBySlug: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newLabel, setNewLabel] = useState("");

  const close = useCallback(() => {
    setError(null);
    setDrafts({});
    setNewLabel("");
    onClose();
  }, [onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Action failed.");
      else router.refresh();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[10vh]"
      onClick={close}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-md border border-line bg-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line bg-panel-head px-4 py-2.5">
          <h2 className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-sec">
            Documentation categories
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="text-dim transition-colors hover:text-txt"
          >
            <IconClose size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-2 p-4">
          {error && (
            <p className="flex items-center gap-2 font-mono text-[11px] text-down">
              <IconWarning size={13} /> {error}
            </p>
          )}

          {categories.map((c) => {
            const value = drafts[c.id] ?? c.label;
            const dirty = value.trim() !== c.label && value.trim().length >= 2;
            const count = pageCountBySlug[c.slug] ?? 0;
            return (
              <div key={c.id} className="flex items-center gap-2">
                <input
                  value={value}
                  onChange={(e) =>
                    setDrafts((d) => ({ ...d, [c.id]: e.target.value }))
                  }
                  className="min-w-0 flex-1 rounded border border-inputline bg-inset px-2.5 py-1.5 text-[13px] text-txt outline-none focus:border-hoverline"
                />
                <span className="w-16 shrink-0 text-right font-mono text-[10px] text-dim">
                  {count} page{count === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  aria-label="Save"
                  disabled={!dirty || pending}
                  onClick={() =>
                    run(() =>
                      saveCategoryAction({
                        id: c.id,
                        label: value.trim(),
                        slug: c.slug,
                        position: c.position,
                      }),
                    )
                  }
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-dim transition-colors hover:bg-hoverbg hover:text-txt disabled:opacity-30"
                >
                  <IconCheck size={14} />
                </button>
                <button
                  type="button"
                  aria-label="Delete"
                  disabled={pending || count > 0}
                  title={count > 0 ? "Move or delete its pages first" : "Delete"}
                  onClick={() => run(() => deleteCategoryAction(c.id))}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-dim transition-colors hover:bg-down/10 hover:text-down disabled:opacity-25"
                >
                  <IconTrash size={14} />
                </button>
              </div>
            );
          })}

          <div className="mt-2 flex items-center gap-2 border-t border-rowline pt-3">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="New category label"
              className="min-w-0 flex-1 rounded border border-inputline bg-inset px-2.5 py-1.5 text-[13px] text-txt outline-none placeholder:text-dim focus:border-hoverline"
            />
            <button
              type="button"
              disabled={newLabel.trim().length < 2 || pending}
              onClick={() =>
                run(async () => {
                  const res = await saveCategoryAction({
                    id: null,
                    label: newLabel.trim(),
                    slug: "",
                    position: categories.length,
                  });
                  if (res.ok) setNewLabel("");
                  return res;
                })
              }
              className="inline-flex shrink-0 items-center gap-1.5 rounded border border-line px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-sec transition-colors hover:border-hoverline hover:text-txt disabled:opacity-30"
            >
              <IconPlus size={13} />
              Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
