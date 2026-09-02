/**
 * The sanitiser is the webapp's only defence against stored XSS: forum bodies are
 * rendered with `dangerouslySetInnerHTML`. These tests pin the shape of the
 * allowlist — what survives, and more importantly what does not.
 */
import { beforeAll, describe, expect, it } from "vitest";

const SUPABASE_URL = "https://example-project.supabase.co";

let sanitizeForumHtml: (dirty: string) => string;
let htmlToText: (html: string) => string;

beforeAll(async () => {
  // Read at module load by sanitize.ts, so it has to be set before the import.
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  const mod = await import("@/lib/forum/sanitize");
  sanitizeForumHtml = mod.sanitizeForumHtml;
  htmlToText = mod.htmlToText;
});

describe("sanitizeForumHtml", () => {
  it("drops scripts and inline event handlers", () => {
    expect(sanitizeForumHtml("<p>hi</p><script>alert(1)</script>")).toBe("<p>hi</p>");
    expect(sanitizeForumHtml('<p onclick="alert(1)">hi</p>')).toBe("<p>hi</p>");
    expect(sanitizeForumHtml('<img src="x" onerror="alert(1)">')).toBe("");
  });

  it("keeps only https and mailto links, and marks them nofollow", () => {
    expect(sanitizeForumHtml('<a href="https://example.com">x</a>')).toContain(
      'rel="nofollow noopener noreferrer"',
    );
    // A disallowed scheme loses the href; the anchor itself stays, inert.
    for (const href of ["javascript:alert(1)", "http://example.com"]) {
      expect(sanitizeForumHtml(`<a href="${href}">x</a>`)).not.toContain("href");
    }
  });

  it("keeps images only when they come from our own storage origin", () => {
    const ours = `<img src="${SUPABASE_URL}/storage/v1/object/public/forum-media/a.png" />`;
    expect(sanitizeForumHtml(ours)).toContain(SUPABASE_URL);
    expect(sanitizeForumHtml('<img src="https://evil.example/a.png" />')).toBe("");
    expect(sanitizeForumHtml('<img src="data:image/png;base64,AAAA" />')).toBe("");
  });

  it("keeps iframes only for the embed hosts Quill can produce", () => {
    expect(
      sanitizeForumHtml('<iframe src="https://www.youtube.com/embed/abc"></iframe>'),
    ).toContain("youtube.com/embed/abc");
    expect(sanitizeForumHtml('<iframe src="https://evil.example/x"></iframe>')).toBe("");
  });

  it("keeps a well-formed TradingView placeholder and drops every other div", () => {
    const good =
      '<div class="tv-embed" data-tv-widget="advanced-chart" data-tv-symbol="AMEX:SPY" data-tv-theme="dark"></div>';
    expect(sanitizeForumHtml(good)).toContain('data-tv-widget="advanced-chart"');
    expect(
      sanitizeForumHtml(
        '<div class="tv-embed" data-tv-widget="not-a-widget" data-tv-symbol="AMEX:SPY" data-tv-theme="dark"></div>',
      ),
    ).toBe("");
    // `exclusiveFilter` drops the frame *and* its contents, so a stray div takes
    // its text with it. Pinned because it is the surprising half of the rule.
    expect(sanitizeForumHtml("<div>plain</div>")).toBe("");
  });

  it("keeps only a px or % width from an inline style", () => {
    const src = `${SUPABASE_URL}/storage/v1/object/public/forum-media/a.png`;
    expect(sanitizeForumHtml(`<img src="${src}" style="width:320px" />`)).toContain("320px");
    expect(
      sanitizeForumHtml(`<img src="${src}" style="width:expression(alert(1))" />`),
    ).not.toContain("expression");
  });
});

describe("htmlToText", () => {
  it("reduces a visually empty body to the empty string", () => {
    expect(htmlToText("<p><br></p>")).toBe("");
    expect(htmlToText("<p>&nbsp;</p>")).toBe("");
  });

  it("strips markup but keeps the words", () => {
    expect(htmlToText("<p>one</p><p><strong>two</strong></p>")).toBe("onetwo");
  });
});
