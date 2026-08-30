"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { DocCategory, DocPage, DocStatus } from "@/lib/docs/types";
import { slugify } from "@/lib/docs/slug";
import {
  previewMarkdownAction,
  savePageAction,
  setPageStatusAction,
  type SavePageInput,
} from "@/app/dashboard/admin/docs/actions";
import {
  IconArrowLeft,
  IconCaretDown,
  IconExternal,
  IconPublish,
  IconUnpublish,
  IconWarning,
} from "@/components/icons";

type ToolbarItem = { label: string; apply: (sel: string) => string };

const TOOLBAR: ToolbarItem[] = [
  { label: "H2", apply: (s) => `## ${s || "Heading"}` },
  { label: "H3", apply: (s) => `### ${s || "Heading"}` },
  { label: "B", apply: (s) => `**${s || "bold"}**` },
  { label: "i", apply: (s) => `*${s || "italic"}*` },
  { label: "Link", apply: (s) => `[${s || "text"}](https://)` },
  { label: "List", apply: (s) => (s || "item").split("\n").map((l) => `- ${l}`).join("\n") },
  { label: "Code", apply: (s) => `\`\`\`\n${s || "code"}\n\`\`\`` },
  {
    label: "Table",
    apply: () => "| Column | Column |\n| --- | --- |\n| Cell | Cell |",
  },
];

function readingStats(md: string): { words: number; minutes: number } {
  const words = md.trim().split(/\s+/).filter(Boolean).length;
  return { words, minutes: Math.max(1, Math.round(words / 200)) };
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function DocsEditor({
  page,
  categories,
  initialCategory,
}: {
  page: DocPage | null;
  categories: DocCategory[];
  initialCategory?: string;
}) {
  const router = useRouter();
  const [publishing, startPublish] = useTransition();

  const [savedId, setSavedId] = useState<string | null>(page?.id ?? null);
  const [status, setStatus] = useState<DocStatus>(page?.status ?? "draft");

  const [title, setTitle] = useState(page?.title ?? "");
  const [manualSlug, setManualSlug] = useState(page?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(Boolean(page));
  // Derived, not an effect: the slug follows the title until edited by hand.
  const slug = slugTouched ? manualSlug : slugify(title);
  const [category, setCategory] = useState(
    page?.category ?? initialCategory ?? categories[0]?.slug ?? "",
  );
  const [orderIndex, setOrderIndex] = useState(page?.order_index ?? 0);
  const [summary, setSummary] = useState(page?.summary ?? "");
  const [contentMd, setContentMd] = useState(page?.content_md ?? "");
  const [seoTitle, setSeoTitle] = useState(page?.seo_title ?? "");
  const [seoDescription, setSeoDescription] = useState(page?.seo_description ?? "");
  const [seoOpen, setSeoOpen] = useState(false);

  const [previewHtml, setPreviewHtml] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstRun = useRef(true);

  const currentInput = useCallback(
    (): SavePageInput => ({
      id: savedId,
      title,
      slug,
      category,
      summary,
      content_md: contentMd,
      order_index: orderIndex,
      seo_title: seoTitle,
      seo_description: seoDescription,
    }),
    [savedId, title, slug, category, summary, contentMd, orderIndex, seoTitle, seoDescription],
  );

  const doSave = useCallback(async () => {
    if (title.trim().length < 2) return;
    setSaving(true);
    setError(null);
    const res = await savePageAction(currentInput());
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setSavedAt(new Date());
    setDirty(false);
    // reflect any server-side de-duplication of the slug
    setSlugTouched(true);
    setManualSlug(res.slug);
    if (!savedId) {
      setSavedId(res.id);
      router.replace(`/dashboard/admin/docs/${res.id}`);
    }
  }, [title, currentInput, savedId, router]);

  // debounced autosave
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setDirty(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(doSave, 2000);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, slug, category, orderIndex, summary, contentMd, seoTitle, seoDescription]);

  // debounced live preview (same renderer as the public page)
  useEffect(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      const { html } = await previewMarkdownAction(contentMd);
      setPreviewHtml(html);
    }, 350);
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, [contentMd]);

  // warn on unsaved navigation away
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  function applyToolbar(item: ToolbarItem) {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart, selectionEnd, value } = ta;
    const selected = value.slice(selectionStart, selectionEnd);
    const insert = item.apply(selected);
    const next = value.slice(0, selectionStart) + insert + value.slice(selectionEnd);
    setContentMd(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = selectionStart + insert.length;
      ta.setSelectionRange(pos, pos);
    });
  }

  function togglePublish() {
    if (!savedId) return;
    const nextStatus: DocStatus = status === "published" ? "draft" : "published";
    setError(null);
    startPublish(async () => {
      // flush a pending edit first so we never publish a stale body
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (dirty) await doSave();
      const res = await setPageStatusAction(savedId, nextStatus);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setStatus(nextStatus);
      router.refresh();
    });
  }

  const { words, minutes } = useMemo(() => readingStats(contentMd), [contentMd]);
  const saveLabel = saving
    ? "Saving…"
    : savedAt
      ? `Saved · ${fmtTime(savedAt)}`
      : dirty
        ? "Unsaved changes"
        : savedId
          ? "Saved"
          : "New page";

  const inputCls =
    "w-full rounded border border-inputline bg-inset px-2.5 py-1.5 text-[13px] text-txt outline-none focus:border-hoverline";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/dashboard/admin/docs"
          className="inline-flex items-center gap-1.5 text-[13px] text-sec transition-colors hover:text-txt"
        >
          <IconArrowLeft size={14} />
          All documentation
        </Link>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-dim">{saveLabel}</span>
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em] ${
              status === "published" ? "bg-up/15 text-up" : "bg-acc/15 text-acc"
            }`}
          >
            {status}
          </span>
          {status === "published" && (
            <a
              href={`/docs/md/${slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded border border-line px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-sec transition-colors hover:border-hoverline hover:text-txt"
            >
              <IconExternal size={12} />
              Markdown
            </a>
          )}
          <button
            type="button"
            disabled={!savedId || publishing}
            onClick={togglePublish}
            className="inline-flex items-center gap-1.5 rounded bg-acc px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-bg transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {status === "published" ? (
              <>
                <IconUnpublish size={13} /> Unpublish
              </>
            ) : (
              <>
                <IconPublish size={13} /> Publish
              </>
            )}
          </button>
        </div>
      </div>

      {error && (
        <p className="flex items-center gap-2 font-mono text-[11px] text-down">
          <IconWarning size={13} /> {error}
        </p>
      )}

      {/* meta */}
      <div className="grid grid-cols-1 gap-3 rounded-md border border-line bg-panel p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="lg:col-span-2">
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.08em] text-dim">
            Title
          </label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Page title"
            className={inputCls}
          />
          <div className="mt-1 flex items-center gap-1">
            <span className="shrink-0 font-mono text-[10px] text-dim">/docs/</span>
            <input
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setManualSlug(slugify(e.target.value));
              }}
              placeholder="page-slug"
              className="min-w-0 flex-1 border-b border-transparent bg-transparent font-mono text-[10px] text-dim outline-none focus:border-hoverline focus:text-txt"
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.08em] text-dim">
            Category
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={`${inputCls} cursor-pointer`}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.08em] text-dim">
            Order
          </label>
          <input
            type="number"
            value={orderIndex}
            onChange={(e) => setOrderIndex(Number(e.target.value) || 0)}
            className={inputCls}
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-4">
          <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.08em] text-dim">
            Summary
          </label>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={2}
            placeholder="1–2 sentences — shown in the nav and as the meta description"
            className={`${inputCls} resize-none`}
          />
        </div>
      </div>

      {/* editor + preview */}
      <div className="grid grid-cols-1 gap-4 min-[1100px]:grid-cols-2">
        <div className="flex min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-1 rounded-t-md border border-inputline bg-panel-head px-1.5 py-1">
            {TOOLBAR.map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => applyToolbar(item)}
                className="rounded px-2 py-1 font-mono text-[11px] text-sec transition-colors hover:bg-hoverbg hover:text-txt"
              >
                {item.label}
              </button>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            value={contentMd}
            onChange={(e) => setContentMd(e.target.value)}
            placeholder="Write in Markdown…"
            spellCheck={false}
            className="min-h-[460px] w-full flex-1 rounded-b-md border border-t-0 border-inputline bg-inset px-3 py-2.5 font-mono text-[12.5px] leading-[1.6] text-txt outline-none"
          />
          <p className="pt-2 font-mono text-[10px] text-dim">
            {words} words · {minutes} min read
          </p>
        </div>

        <div className="min-w-0">
          <div className="flex h-[34px] items-center rounded-t-md border border-line bg-panel-head px-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-dim">
              Preview
            </span>
          </div>
          <div className="min-h-[460px] overflow-auto rounded-b-md border border-t-0 border-line bg-panel px-5 py-4">
            {contentMd.trim() ? (
              <div
                className="docs-content"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            ) : (
              <p className="text-[12px] text-dim">Nothing to preview yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* SEO */}
      <div className="rounded-md border border-line bg-panel p-4">
        <button
          type="button"
          onClick={() => setSeoOpen((v) => !v)}
          className="flex w-full items-center justify-between font-mono text-[11px] uppercase tracking-[0.08em] text-sec"
        >
          SEO overrides
          <IconCaretDown
            size={13}
            className={`transition-transform ${seoOpen ? "rotate-180" : ""}`}
          />
        </button>
        {seoOpen && (
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.08em] text-dim">
                SEO title
              </label>
              <input
                value={seoTitle}
                onChange={(e) => setSeoTitle(e.target.value)}
                placeholder={title}
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block font-mono text-[10px] uppercase tracking-[0.08em] text-dim">
                SEO description
              </label>
              <input
                value={seoDescription}
                onChange={(e) => setSeoDescription(e.target.value)}
                placeholder={summary}
                className={inputCls}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
