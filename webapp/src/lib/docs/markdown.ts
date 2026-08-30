/**
 * The one Markdown renderer for the documentation section. Used by the public
 * page (`/docs/[slug]`) and by the admin editor's live preview (through
 * `previewMarkdownAction`), so what the author sees while writing is exactly
 * what the site serves.
 *
 * `content_md` is authored by the master-admin in a plain textarea and then
 * rendered on a public page, so raw HTML in the source is dropped (no
 * `marked` HTML passthrough survives the sanitiser's allowlist) and the
 * output is run through `sanitize-html` before it ever reaches the browser.
 * Headings get slug ids here so the on-page table of contents can link to
 * them.
 */
import "server-only";
import { marked, type Tokens } from "marked";
import sanitizeHtml from "sanitize-html";
import type { DocHeading } from "@/lib/docs/types";

function baseSlug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "section"
  );
}

/** Stateful slugger: same call sequence => same ids, with `-2`, `-3` on repeats. */
function makeSlugger() {
  const seen = new Map<string, number>();
  return (text: string): string => {
    const base = baseSlug(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n + 1}`;
  };
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr",
    "strong", "em", "del", "code", "pre", "blockquote",
    "ul", "ol", "li",
    "a", "img",
    "table", "thead", "tbody", "tr", "th", "td",
  ],
  allowedAttributes: {
    h1: ["id"], h2: ["id"], h3: ["id"], h4: ["id"], h5: ["id"], h6: ["id"],
    a: ["href", "title", "target", "rel"],
    img: ["src", "alt", "title"],
    td: ["align"],
    th: ["align"],
  },
  allowedSchemes: ["https", "http", "mailto"],
  allowedSchemesByTag: { img: ["https"] },
  transformTags: {
    a: (tagName, attribs) => {
      const href = attribs.href ?? "";
      const external = /^https?:\/\//i.test(href);
      return {
        tagName,
        attribs: external
          ? { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" }
          : attribs,
      };
    },
  },
};

export type RenderedDoc = { html: string; headings: DocHeading[] };

/** Parse + sanitise `content_md`, and pull an h2/h3 outline for the TOC. */
export function renderDocMarkdown(md: string): RenderedDoc {
  const source = md ?? "";

  // Outline pass — headings render in document order, so a fresh slugger here
  // yields the same ids as the one used by the renderer below.
  const outlineSlugger = makeSlugger();
  const headings: DocHeading[] = [];
  for (const token of marked.lexer(source)) {
    if (token.type !== "heading") continue;
    const h = token as Tokens.Heading;
    if (h.depth !== 2 && h.depth !== 3) continue;
    headings.push({
      id: outlineSlugger(h.text),
      text: h.text,
      level: h.depth,
    });
  }

  const renderSlugger = makeSlugger();
  const renderer = new marked.Renderer();
  renderer.heading = function heading({ tokens, depth }: Tokens.Heading): string {
    const inner = this.parser.parseInline(tokens);
    const plain = tokens.map((t) => ("text" in t ? String(t.text) : "")).join("");
    const id =
      depth === 2 || depth === 3 ? ` id="${renderSlugger(plain)}"` : "";
    return `<h${depth}${id}>${inner}</h${depth}>\n`;
  };

  const rawHtml = marked.parse(source, { renderer, async: false }) as string;
  const html = sanitizeHtml(rawHtml, SANITIZE_OPTIONS).trim();
  return { html, headings };
}

/** Plain-text projection of the source — reading time, meta description fallback. */
export function docPlainText(md: string): string {
  return sanitizeHtml(marked.parse(md ?? "", { async: false }) as string, {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(/\s+/g, " ")
    .trim();
}
