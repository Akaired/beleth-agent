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
  IconArrowDown,
  IconArrowUp,
  IconCheck,
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
}: {
  pages: DocPage[];
  categories: DocCategory[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);

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

  function move(groupPages: DocPage[], index: number, dir: -1 | 1) {
    const swap = index + dir;
    if (swap < 0 || swap >= groupPages.length) return;
    const a = groupPages[index];
    const b = groupPages[swap];
    run(() =>
      reorderPagesAction([
        { id: a.id, order_index: b.order_index },
        { id: b.id, order_index: a.order_index },
      ]),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-sec">
          Pages served at <span className="font-mono text-txt">/docs</span>. Drafts
          stay invisible to the public until published.
        </p>
        <button
          type="button"
          onClick={() => setCatsOpen(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded border border-line px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-sec transition-colors hover:border-hoverline hover:text-txt"
        >
          <IconSettings size={13} />
          Categories
        </button>
      </div>

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
            <Link
              href={`/dashboard/admin/docs/new?category=${category.slug}`}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-sec transition-colors hover:text-acc"
            >
              <IconPlus size={13} />
              Add page
            </Link>
          </div>

          {groupPages.length === 0 ? (
            <p className="px-4 py-3 text-[12px] text-dim">No pages yet.</p>
          ) : (
            <ul className="divide-y divide-rowline">
              {groupPages.map((page, i) => (
                <li
                  key={page.id}
                  className="flex items-center gap-3 px-4 py-2.5 text-[13px]"
                >
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      aria-label="Move up"
                      disabled={i === 0 || pending}
                      onClick={() => move(groupPages, i, -1)}
                      className="text-dim transition-colors hover:text-txt disabled:opacity-30"
                    >
                      <IconArrowUp size={12} />
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      disabled={i === groupPages.length - 1 || pending}
                      onClick={() => move(groupPages, i, 1)}
                      className="text-dim transition-colors hover:text-txt disabled:opacity-30"
                    >
                      <IconArrowDown size={12} />
                    </button>
                  </div>

                  <Link
                    href={`/dashboard/admin/docs/${page.id}`}
                    className="min-w-0 flex-1 truncate font-medium text-txt transition-colors hover:text-acc"
                  >
                    {page.title}
                    <span className="ml-2 font-mono text-[11px] text-dim">
                      /{page.slug}
                    </span>
                  </Link>

                  <StatusPill published={page.status === "published"} />

                  <div className="flex shrink-0 items-center gap-1">
                    <Link
                      href={`/dashboard/admin/docs/${page.id}`}
                      aria-label="Edit"
                      className="flex h-7 w-7 items-center justify-center rounded text-dim transition-colors hover:bg-hoverbg hover:text-txt"
                    >
                      <IconPencil size={14} />
                    </Link>
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
                            page.status === "published" ? "draft" : "published",
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
                  </div>
                </li>
              ))}
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
