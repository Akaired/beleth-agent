"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { timeAgo } from "@/lib/forum/format";
import type {
  ForumCategoryWithCount,
  ForumTopicListItem,
} from "@/lib/forum/types";
import {
  deleteCategoryAction,
  deleteTopicAction,
  reorderCategoriesAction,
  updateTopicAction,
} from "@/app/dashboard/admin/forum/actions";
import { ForumCategoryModal } from "@/components/dashboard/admin/forum-category-modal";
import {
  IconCheck,
  IconDragHandle,
  IconEye,
  IconLock,
  IconLockOpen,
  IconPencil,
  IconPin,
  IconPlus,
  IconSearch,
  IconTrash,
  IconUnpin,
  IconWarning,
} from "@/components/icons";

const TOPICS_PER_PAGE = 20;

type ActionResult = { ok: boolean; error?: string };

export function ForumAdmin({
  categories,
  topics,
  canWrite,
}: {
  categories: ForumCategoryWithCount[];
  topics: ForumTopicListItem[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<ActionResult>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Action failed.");
      else router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {error && (
        <p className="flex items-center gap-2 font-mono text-[11px] text-down">
          <IconWarning size={13} /> {error}
        </p>
      )}

      <CategoriesSection
        categories={categories}
        canWrite={canWrite}
        pending={pending}
        run={run}
      />

      <TopicsSection
        categories={categories}
        topics={topics}
        canWrite={canWrite}
        pending={pending}
        run={run}
      />
    </div>
  );
}

// ── categories ────────────────────────────────────────────────────────────

function CategoriesSection({
  categories,
  canWrite,
  pending,
  run,
}: {
  categories: ForumCategoryWithCount[];
  canWrite: boolean;
  pending: boolean;
  run: (fn: () => Promise<ActionResult>) => void;
}) {
  const [modalFor, setModalFor] = useState<
    ForumCategoryWithCount | null | "new"
  >(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const ordered = useMemo(
    () => [...categories].sort((a, b) => a.position - b.position),
    [categories],
  );

  /** Drop `fromId` onto `toId`, renumber the list 1..N, and persist the rows
   * whose position actually changed (compared against each row's own original
   * position — not the value that happened to sit at that slot). */
  function reorder(fromId: string, toId: string) {
    if (fromId === toId) return;
    const from = ordered.findIndex((c) => c.id === fromId);
    const to = ordered.findIndex((c) => c.id === toId);
    if (from === -1 || to === -1) return;
    const next = [...ordered];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const origPos = new Map(ordered.map((c) => [c.id, c.position]));
    const changed = next
      .map((c, i) => ({ id: c.id, position: i + 1 }))
      .filter((row) => row.position !== origPos.get(row.id));
    if (changed.length === 0) return;
    run(() => reorderCategoriesAction(changed));
  }

  return (
    <section className="overflow-hidden rounded-md border border-line bg-panel">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-panel-head px-4 py-2.5">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-sec">
          Categories
        </h2>
        {canWrite ? (
          <button
            type="button"
            onClick={() => setModalFor("new")}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-sec transition-colors hover:text-acc"
          >
            <IconPlus size={13} />
            New category
          </button>
        ) : (
          <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
            read-only
          </span>
        )}
      </div>

      {ordered.length === 0 ? (
        <p className="px-4 py-3 text-[12px] text-dim">No categories yet.</p>
      ) : (
        <ul className="divide-y divide-rowline">
          {ordered.map((c) => {
            const isDragging = draggingId === c.id;
            const isOver = overId === c.id && draggingId !== null && !isDragging;
            return (
              <li
                key={c.id}
                draggable={armedId === c.id}
                onDragStart={(e) => {
                  setDraggingId(c.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  setArmedId(null);
                  setDraggingId(null);
                  setOverId(null);
                }}
                onDragOver={(e) => {
                  if (!draggingId) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (overId !== c.id) setOverId(c.id);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggingId) reorder(draggingId, c.id);
                  setOverId(null);
                }}
                className={`flex items-center gap-3 px-4 py-2.5 text-[13px] transition-colors ${
                  isDragging ? "opacity-40" : ""
                } ${
                  isOver
                    ? "bg-acc/10 shadow-[inset_0_2px_0_0_var(--color-acc)]"
                    : ""
                }`}
              >
                {canWrite && (
                  <button
                    type="button"
                    aria-label="Drag to reorder"
                    disabled={pending || ordered.length < 2}
                    onPointerDown={() => setArmedId(c.id)}
                    onPointerUp={() =>
                      setArmedId((id) => (id === c.id ? null : id))
                    }
                    className="flex shrink-0 cursor-grab touch-none items-center text-dim transition-colors hover:text-txt active:cursor-grabbing disabled:cursor-default disabled:opacity-30"
                  >
                    <IconDragHandle size={16} />
                  </button>
                )}

                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                  style={{ background: c.color }}
                />

                <div className="min-w-0 flex-1">
                  <span className="font-medium text-txt">{c.name}</span>
                  <span className="ml-2 font-mono text-[11px] text-dim">
                    /{c.slug}
                  </span>
                  {c.description && (
                    <p className="mt-0.5 truncate text-[11.5px] text-sec">
                      {c.description}
                    </p>
                  )}
                </div>

                <span className="shrink-0 font-mono text-[10.5px] text-dim">
                  {c.topic_count} topic{c.topic_count === 1 ? "" : "s"}
                </span>

                {canWrite && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      aria-label="Edit"
                      onClick={() => setModalFor(c)}
                      className="flex h-7 w-7 items-center justify-center rounded text-dim transition-colors hover:bg-hoverbg hover:text-txt"
                    >
                      <IconPencil size={14} />
                    </button>
                    {confirmId === c.id ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          setConfirmId(null);
                          run(() => deleteCategoryAction(c.id));
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
                        disabled={pending || c.topic_count > 0}
                        title={
                          c.topic_count > 0
                            ? "Move or delete its topics first"
                            : "Delete"
                        }
                        onClick={() => setConfirmId(c.id)}
                        className="flex h-7 w-7 items-center justify-center rounded text-dim transition-colors hover:bg-down/10 hover:text-down disabled:opacity-25"
                      >
                        <IconTrash size={14} />
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ForumCategoryModal
        open={modalFor !== null}
        onClose={() => setModalFor(null)}
        category={modalFor === "new" || modalFor === null ? null : modalFor}
        nextPosition={ordered.length + 1}
        categoryCount={ordered.length}
      />
    </section>
  );
}

// ── topics ────────────────────────────────────────────────────────────────

function TopicsSection({
  categories,
  topics,
  canWrite,
  pending,
  run,
}: {
  categories: ForumCategoryWithCount[];
  topics: ForumTopicListItem[];
  canWrite: boolean;
  pending: boolean;
  run: (fn: () => Promise<ActionResult>) => void;
}) {
  const [q, setQ] = useState("");
  const [catFilter, setCatFilter] = useState("");
  const [page, setPage] = useState(0);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return topics.filter((t) => {
      if (catFilter && t.category_slug !== catFilter) return false;
      if (needle && !t.title.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [topics, q, catFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / TOPICS_PER_PAGE));
  const clampedPage = Math.min(page, pageCount - 1);
  const rows = filtered.slice(
    clampedPage * TOPICS_PER_PAGE,
    clampedPage * TOPICS_PER_PAGE + TOPICS_PER_PAGE,
  );

  return (
    <section className="overflow-hidden rounded-md border border-line bg-panel">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-panel-head px-4 py-2.5">
        <h2 className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-sec">
          Topics
          <span className="ml-2 text-faint">{filtered.length}</span>
        </h2>
        <div className="flex items-center gap-2">
          <select
            value={catFilter}
            onChange={(e) => {
              setCatFilter(e.target.value);
              setPage(0);
            }}
            className="rounded border border-inputline bg-inset px-2 py-1 font-mono text-[10.5px] text-sec outline-none focus:border-hoverline"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1.5 rounded border border-inputline bg-inset px-2 py-1">
            <IconSearch size={12} className="text-dim" />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
              placeholder="Filter by title"
              className="w-32 bg-transparent text-[12px] text-txt outline-none placeholder:text-dim"
            />
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-3 text-[12px] text-dim">No topics match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="border-b border-rowline font-mono text-[9.5px] uppercase tracking-[0.08em] text-faint">
                <th className="px-4 py-2 text-left font-normal">Topic</th>
                <th className="px-3 py-2 text-left font-normal">Category</th>
                <th className="px-3 py-2 text-left font-normal">Author</th>
                <th className="px-3 py-2 text-right font-normal">R / V</th>
                <th className="px-3 py-2 text-right font-normal">Activity</th>
                {canWrite && (
                  <th className="px-4 py-2 text-right font-normal">Manage</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-rowline">
              {rows.map((t) => (
                <tr key={t.id} className="align-top">
                  <td className="px-4 py-2.5">
                    <div className="flex items-start gap-1.5">
                      {t.pinned && (
                        <IconPin
                          size={12}
                          weight="fill"
                          className="mt-0.5 shrink-0 text-acc"
                        />
                      )}
                      {t.closed && (
                        <IconLock
                          size={12}
                          className="mt-0.5 shrink-0 text-dim"
                        />
                      )}
                      <Link
                        href={`/forum/t/${t.slug}`}
                        className="text-txt transition-colors hover:text-acc"
                      >
                        {t.title}
                      </Link>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {canWrite ? (
                      <select
                        value={t.category_slug}
                        disabled={pending}
                        onChange={(e) => {
                          const cat = categories.find(
                            (c) => c.slug === e.target.value,
                          );
                          if (cat && cat.id !== t.category_id) {
                            run(() =>
                              updateTopicAction(t.id, { categoryId: cat.id }),
                            );
                          }
                        }}
                        className="max-w-[150px] rounded border border-inputline bg-inset px-1.5 py-0.5 font-mono text-[10.5px] text-sec outline-none focus:border-hoverline"
                      >
                        {categories.map((c) => (
                          <option key={c.id} value={c.slug}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-dim">
                        <span
                          className="h-2 w-2 rounded-[2px]"
                          style={{ background: t.category_color }}
                        />
                        {t.category_name}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[10.5px] text-dim">
                    {t.author_name}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[10.5px] text-dim">
                    {t.reply_count} / {t.view_count}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[10.5px] text-dim">
                    {timeAgo(t.last_posted_at)}
                  </td>
                  {canWrite && (
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          aria-label={t.pinned ? "Unpin" : "Pin"}
                          title={t.pinned ? "Unpin" : "Pin"}
                          disabled={pending}
                          onClick={() =>
                            run(() =>
                              updateTopicAction(t.id, { pinned: !t.pinned }),
                            )
                          }
                          className={`flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-hoverbg disabled:opacity-40 ${
                            t.pinned ? "text-acc" : "text-dim hover:text-txt"
                          }`}
                        >
                          {t.pinned ? (
                            <IconUnpin size={14} />
                          ) : (
                            <IconPin size={14} />
                          )}
                        </button>
                        <button
                          type="button"
                          aria-label={t.closed ? "Reopen" : "Close"}
                          title={t.closed ? "Reopen" : "Close"}
                          disabled={pending}
                          onClick={() =>
                            run(() =>
                              updateTopicAction(t.id, { closed: !t.closed }),
                            )
                          }
                          className={`flex h-7 w-7 items-center justify-center rounded transition-colors hover:bg-hoverbg disabled:opacity-40 ${
                            t.closed ? "text-acc" : "text-dim hover:text-txt"
                          }`}
                        >
                          {t.closed ? (
                            <IconLockOpen size={14} />
                          ) : (
                            <IconLock size={14} />
                          )}
                        </button>
                        <a
                          href={`/forum/t/${t.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Open"
                          className="flex h-7 w-7 items-center justify-center rounded text-dim transition-colors hover:bg-hoverbg hover:text-txt"
                        >
                          <IconEye size={14} />
                        </a>
                        {confirmId === t.id ? (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => {
                              setConfirmId(null);
                              run(() => deleteTopicAction(t.id));
                            }}
                            className="flex h-7 items-center gap-1 rounded bg-down/15 px-2 font-mono text-[10px] uppercase tracking-[0.08em] text-down"
                          >
                            <IconCheck size={12} />
                            Sure?
                          </button>
                        ) : (
                          <button
                            type="button"
                            aria-label="Delete topic"
                            disabled={pending}
                            onClick={() => setConfirmId(t.id)}
                            className="flex h-7 w-7 items-center justify-center rounded text-dim transition-colors hover:bg-down/10 hover:text-down disabled:opacity-40"
                          >
                            <IconTrash size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between border-t border-rowline px-4 py-2 font-mono text-[10.5px] text-dim">
          <span>
            Page {clampedPage + 1} / {pageCount}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              disabled={clampedPage === 0}
              onClick={() => setPage(clampedPage - 1)}
              className="rounded px-2 py-1 transition-colors hover:text-txt disabled:opacity-30"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={clampedPage >= pageCount - 1}
              onClick={() => setPage(clampedPage + 1)}
              className="rounded px-2 py-1 transition-colors hover:text-txt disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
