import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  fetchPublishedDocBySlug,
  fetchPublishedDocNav,
} from "@/lib/docs/queries";
import { renderDocMarkdown } from "@/lib/docs/markdown";
import { DocsSideNav } from "@/components/docs/docs-side-nav";
import { DocsMobileNav } from "@/components/docs/docs-mobile-nav";
import { CopyForLlm } from "@/components/docs/copy-for-llm";
import {
  IconArrowLeft,
  IconArrowRight,
  IconExternal,
} from "@/components/icons";

function fmtDate(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export async function generateMetadata({
  params,
}: PageProps<"/docs/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const page = await fetchPublishedDocBySlug(slug);
  if (!page) return { title: "Documentation — Beleth" };
  const description = page.seo_description || page.summary || undefined;
  return {
    title: `${page.seo_title || page.title} — Beleth docs`,
    description,
  };
}

export default async function DocPage({ params }: PageProps<"/docs/[slug]">) {
  const { slug } = await params;
  const [page, groups] = await Promise.all([
    fetchPublishedDocBySlug(slug),
    fetchPublishedDocNav(),
  ]);
  if (!page) notFound();

  const { html, headings } = renderDocMarkdown(page.content_md);

  const siblings =
    groups.find((g) => g.category.slug === page.category)?.pages ?? [];
  const idx = siblings.findIndex((p) => p.slug === page.slug);
  const prev = idx > 0 ? siblings[idx - 1] : null;
  const next =
    idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
  const categoryLabel =
    groups.find((g) => g.category.slug === page.category)?.category.label ??
    page.category;

  return (
    <div className="mx-auto w-full max-w-6xl">
      <nav className="mb-5 flex items-center gap-2 text-[12px] text-sec">
        <Link href="/docs" className="text-acc transition-colors hover:opacity-80">
          Docs
        </Link>
        <span className="text-dim">/</span>
        <span className="truncate">{page.title}</span>
      </nav>

      <div className="mb-5 lg:hidden">
        <DocsMobileNav
          groups={groups}
          currentSlug={page.slug}
          currentTitle={page.title}
        />
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[210px_minmax(0,1fr)_190px]">
        <aside className="hidden lg:block lg:sticky lg:top-6 lg:self-start">
          <DocsSideNav groups={groups} currentSlug={page.slug} />
        </aside>

        <article className="min-w-0">
          <header className="mb-8 border-b border-line pb-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <span className="inline-flex items-center rounded-full border border-acc/40 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-acc">
                {categoryLabel}
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={`/docs/md/${page.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded border border-line px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-sec transition-colors hover:border-hoverline hover:text-txt"
                >
                  <IconExternal size={12} />
                  Markdown
                </a>
                <CopyForLlm slug={page.slug} />
              </div>
            </div>
            <h1 className="mb-3 text-[clamp(22px,3vw,30px)] font-light leading-tight text-txt">
              {page.title}
            </h1>
            {page.summary && (
              <p className="mb-3 text-[14px] leading-relaxed text-sec">
                {page.summary}
              </p>
            )}
            {page.updated_at && (
              <p className="font-mono text-[10.5px] text-dim">
                Last updated {fmtDate(page.updated_at)}
              </p>
            )}
          </header>

          <div
            className="docs-content"
            dangerouslySetInnerHTML={{ __html: html }}
          />

          {(prev || next) && (
            <div className="mt-14 grid grid-cols-1 gap-3 border-t border-line pt-8 sm:grid-cols-2">
              {prev ? (
                <Link
                  href={`/docs/${prev.slug}`}
                  className="flex items-center gap-2 rounded-md border border-line p-4 transition-colors hover:border-hoverline"
                >
                  <IconArrowLeft size={15} className="shrink-0 text-dim" />
                  <span className="min-w-0">
                    <span className="block font-mono text-[10px] uppercase tracking-[0.08em] text-dim">
                      Previous
                    </span>
                    <span className="block truncate text-[13px] font-medium text-txt">
                      {prev.title}
                    </span>
                  </span>
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link
                  href={`/docs/${next.slug}`}
                  className="flex items-center justify-end gap-2 rounded-md border border-line p-4 text-right transition-colors hover:border-hoverline"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-[10px] uppercase tracking-[0.08em] text-dim">
                      Next
                    </span>
                    <span className="block truncate text-[13px] font-medium text-txt">
                      {next.title}
                    </span>
                  </span>
                  <IconArrowRight size={15} className="shrink-0 text-dim" />
                </Link>
              )}
            </div>
          )}
        </article>

        {headings.length > 0 && (
          <aside className="hidden lg:block lg:sticky lg:top-6 lg:self-start">
            <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
              On this page
            </p>
            <nav className="flex flex-col gap-1.5">
              {headings.map((h) => (
                <a
                  key={h.id}
                  href={`#${h.id}`}
                  className={`text-[12px] text-sec transition-colors hover:text-acc ${
                    h.level === 3 ? "pl-3" : ""
                  }`}
                >
                  {h.text}
                </a>
              ))}
            </nav>
          </aside>
        )}
      </div>
    </div>
  );
}
