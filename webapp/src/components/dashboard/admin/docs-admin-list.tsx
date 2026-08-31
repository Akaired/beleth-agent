"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DocCategory, DocPage } from "@/lib/docs/types";
import {
  deletePageAction,
  reorderPagesAction,
  setPageStatusAction,
} from "@/app/dashboard/admin/docs/actions";
import { DocsCategoriesModal } from "@/components/dashboard/admin/docs-categories-modal";
import {
  IconCheck,
  IconDragHandle,
  IconEye,
  IconPencil,
  IconPlus,
  IconPublish,
  IconSettings,
  IconTrash,
  IconUnpublish,
  IconWarning,
} from "@/components/icons";

function StatusPill({ published }: { published: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em] ${
        published ? "bg-up/15 text-up" : "bg-acc/15 text-acc"
      }`}
    >
      {published ? "Published" : "Draft"}
    </span>
  );
}

export function DocsAdminList({
  pages,
  categories,
  canWrite = true,
}: {
  pages: DocPage[];
  categories: DocCategory[];
  /** false for the read-only demo-admin account — hides every edit control. */
  canWrite?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Action failed.");
      else router.refresh();
    });
  }

  const grouped = categories.map((category) => ({
    category,
    pages: pages
      .filter((p) => p.category === category.slug)
      .sort((a, b) => a.order_index - b.order_index),
  }));
  const orphans = pages.filter(
    (p) => !categories.some((c) => c.slug === p.category),
  );

  /** Drop `fromId` onto `toId`'s slot within one category, keeping the group's
   * existing set of order_index values so only the moved rows shift. */
  function reorder(groupPages: DocPage[], fromId: string, toId: string) {
    if (fromId === toId) return;
    const from = groupPages.findIndex((p) => p.id === fromId);
    const to = groupPages.findIndex((p) => p.id === toId);
    if (from === -1 || to === -1) return;
    const next = [...groupPages];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const slots = groupPages.map((p) => p.order_index).sort((a, b) => a - b);
    const changed = next
      .map((p, i) => ({ id: p.id, order_index: slots[i] }))
      .filter((row, i) => row.order_index !== groupPages[i].order_index);
    if (changed.length === 0) return;
    run(() => reorderPagesAction(changed));
  }

  return (
    <div className="flex flex-col gap-4">
      {canWrite ? (
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setCatsOpen(true)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded border border-line px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-sec transition-colors hover:border-hoverline hover:text-txt"
          >
            <IconSettings size={13} />
            Categories
          </button>
        </div>
      ) : (
        <p className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-dim">
          Read-only — drafts included
        </p>
      )}

      {error && (
        <p className="flex items-center gap-2 font-mono text-[11px] text-down">
          <IconWarning size={13} /> {error}
        </p>
      )}

      {grouped.map(({ category, pages: groupPages }) => (
        <section
          key={category.id}
          className="overflow-hidden rounded-md border border-line bg-panel"
        >
          <div className="flex items-center justify-between gap-3 border-b border-line bg-panel-head px-4 py-2.5">
            <h2 className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-sec">
              {category.label}
            </h2>
            {canWrite && (
              <Link
                href={`/dashboard/admin/docs/new?category=${category.slug}`}
                className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-sec transition-colors hover:text-acc"
              >
                <IconPlus size={13} />
                Add page
              </Link>
            )}
          </div>

          {groupPages.length === 0 ? (
            <p className="px-4 py-3 text-[12px] text-dim">No pages yet.</p>
          ) : (
            <ul className="divide-y divide-rowline">
              {groupPages.map((page) => {
                const isDragging = draggingId === page.id;
                const isOver =
                  overId === page.id && draggingId !== null && !isDragging;
                return (
                  <li
                    key={page.id}
                    draggable={canWrite && armedId === page.id}
                    onDragStart={(e) => {
                      setDraggingId(page.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => {
                      setArmedId(null);
                      setDraggingId(null);
                      setOverId(null);
                    }}
                    onDragOver={(e) => {
                      if (!draggingId) return;
                      if (!groupPages.some((p) => p.id === draggingId)) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (overId !== page.id) setOverId(page.id);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (draggingId) reorder(groupPages, draggingId, page.id);
                      setOverId(null);
                    }}
                    className={`flex items-center gap-3 px-4 py-2.5 text-[13px] transition-colors ${
                      isDragging ? "opacity-40" : ""
                    } ${isOver ? "bg-acc/10 shadow-[inset_0_2px_0_0_var(--color-acc)]" : ""}`}
                  >
                    {canWrite && (
                      <button
                        type="button"
                        aria-label="Drag to reorder"
                        disabled={pending || groupPages.length < 2}
                        onPointerDown={() => setArmedId(page.id)}
                        onPointerUp={() =>
                          setArmedId((id) => (id === page.id ? null : id))
                        }
                        className="flex shrink-0 cursor-grab touch-none items-center text-dim transition-colors hover:text-txt active:cursor-grabbing disabled:cursor-default disabled:opacity-30"
                      >
                        <IconDragHandle size={16} />
                      </button>
                    )}

                    {canWrite ? (
                      <Link
                        href={`/dashboard/admin/docs/${page.id}`}
                        className="min-w-0 flex-1 truncate font-medium text-txt transition-colors hover:text-acc"
                      >
                        {page.title}
                        <span className="ml-2 font-mono text-[11px] text-dim">
                          /{page.slug}
                        </span>
                      </Link>
                    ) : (
                      <span className="min-w-0 flex-1 truncate font-medium text-txt">
                        {page.title}
                        <span className="ml-2 font-mono text-[11px] text-dim">
                          /{page.slug}
                        </span>
                      </span>
                    )}

                    <StatusPill published={page.status === "published"} />

                    <div className="flex shrink-0 items-center gap-1">
                      {canWrite && (
                        <Link
                          href={`/dashboard/admin/docs/${page.id}`}
                          aria-label="Edit"
                          className="flex h-7 w-7 items-center justify-center rounded text-dim transition-colors hover:bg-hoverbg hover:text-txt"
                        >
                          <IconPencil size={14} />
                        </Link>
                      )}
                      {page.status === "published" && (
                        <a
                          href={`/docs/${page.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="View"
                          className="flex h-7 w-7 items-center justify-center rounded text-dim transition-colors hover:bg-hoverbg hover:text-txt"
                        >
                          <IconEye size={14} />
                        </a>
                      )}
                      {canWrite && (
                      <>
                      <button
                        type="button"
                        aria-label={
                          page.status === "published" ? "Unpublish" : "Publish"
                        }
                        disabled={pending}
                        onClick={() =>
                          run(() =>
                            setPageStatusAction(
                              page.id,
                              page.status === "published"
                                ? "draft"
                                : "published",
                            ),
                          )
                        }
                        className="flex h-7 w-7 items-center justify-center rounded text-dim transition-colors hover:bg-hoverbg hover:text-txt disabled:opacity-40"
                      >
                        {page.status === "published" ? (
                          <IconUnpublish size={14} />
                        ) : (
                          <IconPublish size={14} />
                        )}
                      </button>
                      {confirmId === page.id ? (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => {
                            setConfirmId(null);
                            run(() => deletePageAction(page.id));
                          }}
                          className="flex h-7 items-center gap-1 rounded bg-down/15 px-2 font-mono text-[10px] uppercase tracking-[0.08em] text-down"
                        >
                          <IconCheck size={12} />
                          Sure?
                        </button>
                      ) : (
                        <button
                          type="button"
                          aria-label="Delete"
                          disabled={pending}
                          onClick={() => setConfirmId(page.id)}
                          className="flex h-7 w-7 items-center justify-center rounded text-dim transition-colors hover:bg-down/10 hover:text-down disabled:opacity-40"
                        >
                          <IconTrash size={14} />
                        </button>
                      )}
                      </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}

      {orphans.length > 0 && (
        <p className="font-mono text-[11px] text-acc">
          {orphans.length} page(s) point at a missing category — edit them to
          reassign.
        </p>
      )}

      <DocsCategoriesModal
        open={catsOpen}
        onClose={() => setCatsOpen(false)}
        categories={categories}
        pageCountBySlug={Object.fromEntries(
          categories.map((c) => [
            c.slug,
            pages.filter((p) => p.category === c.slug).length,
          ]),
        )}
      />
    </div>
  );
}
