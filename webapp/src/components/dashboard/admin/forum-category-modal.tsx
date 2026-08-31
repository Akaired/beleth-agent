"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ForumCategoryWithCount } from "@/lib/forum/types";
import { saveCategoryAction } from "@/app/dashboard/admin/forum/actions";
import { IconClose, IconWarning } from "@/components/icons";
import {
  FORUM_PALETTE_ANCHORS,
  forumCategoryColor,
  forumPalette,
} from "@/lib/forum/palette";

export function ForumCategoryModal({
  open,
  onClose,
  category,
  nextPosition,
  categoryCount,
}: {
  open: boolean;
  onClose: () => void;
  /** null → create; a row → edit. */
  category: ForumCategoryWithCount | null;
  nextPosition: number;
  /** How many categories exist now — drives how many swatches the palette shows. */
  categoryCount: number;
}) {
  if (!open) return null;
  // Unmounted while closed, so the inner form's state always starts fresh from
  // props — no syncing effect needed. `key` guards the open→open category swap.
  return (
    <ModalBody
      key={category?.id ?? "new"}
      onClose={onClose}
      category={category}
      nextPosition={nextPosition}
      categoryCount={categoryCount}
    />
  );
}

function ModalBody({
  onClose,
  category,
  nextPosition,
  categoryCount,
}: {
  onClose: () => void;
  category: ForumCategoryWithCount | null;
  nextPosition: number;
  categoryCount: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  // Swatches: 4 anchors by default, more in-between shades as categories grow.
  const swatches = forumPalette(
    Math.max(FORUM_PALETTE_ANCHORS.length, categoryCount + 1),
  );
  const [color, setColor] = useState<string>(
    category?.color ?? forumCategoryColor(categoryCount, categoryCount + 1),
  );
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => firstFieldRef.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const dirty =
    name.trim().length >= 2 &&
    (name.trim() !== (category?.name ?? "") ||
      description.trim() !== (category?.description ?? "") ||
      color !== (category?.color ?? ""));

  function save() {
    setError(null);
    start(async () => {
      const res = await saveCategoryAction({
        id: category?.id ?? null,
        name: name.trim(),
        slug: category?.slug ?? "",
        description: description.trim(),
        color,
        position: category?.position ?? nextPosition,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-[10vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-md border border-line bg-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line bg-panel-head px-4 py-2.5">
          <h2 className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-sec">
            {category ? "Edit category" : "New category"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-dim transition-colors hover:text-txt"
          >
            <IconClose size={15} />
          </button>
        </div>

        <div className="flex flex-col gap-3 p-4">
          {error && (
            <p className="flex items-center gap-2 font-mono text-[11px] text-down">
              <IconWarning size={13} /> {error}
            </p>
          )}

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-dim">
              Name
            </span>
            <input
              ref={firstFieldRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              className="rounded border border-inputline bg-inset px-2.5 py-1.5 text-[13px] text-txt outline-none focus:border-hoverline"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-dim">
              Description
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="resize-none rounded border border-inputline bg-inset px-2.5 py-1.5 text-[13px] leading-relaxed text-txt outline-none focus:border-hoverline"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-dim">
              Colour
            </span>
            <div className="flex flex-wrap gap-2">
              {swatches.map((c, i) => (
                <button
                  key={`${c}-${i}`}
                  type="button"
                  aria-label={c}
                  onClick={() => setColor(c)}
                  style={{ background: c }}
                  className={`h-6 w-6 rounded-[3px] transition-transform ${
                    color.toLowerCase() === c.toLowerCase()
                      ? "ring-2 ring-txt ring-offset-2 ring-offset-panel"
                      : "hover:scale-110"
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-rowline px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-sec transition-colors hover:text-txt"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!dirty || pending}
            onClick={save}
            className="rounded bg-acc/15 px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-acc transition-colors hover:bg-acc/25 disabled:opacity-40"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
