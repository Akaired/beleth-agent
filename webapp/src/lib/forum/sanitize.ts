/**
 * Server-side sanitiser for forum post HTML. The WYSIWYG editor (Quill) is
 * untrusted output, so every post body is run through this allowlist BEFORE it
 * is stored and again when it is rendered. Images are only kept when they point
 * at our own Supabase Storage bucket (uploads go through /api/forum/upload);
 * data: URIs and off-host images are dropped so a post can't smuggle in a huge
 * base64 blob or an external tracker. The only iframes allowed are YouTube /
 * Vimeo embeds (Quill's video button already rewrites watch URLs to those).
 */
import "server-only";
import sanitizeHtml from "sanitize-html";
import { isValidTvEmbed } from "@/lib/forum/tradingview";

const SUPABASE_ORIGIN = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return "";
  }
})();

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "br",
    "strong",
    "em",
    "u",
    "s",
    "blockquote",
    "ul",
    "ol",
    "li",
    "h2",
    "h3",
    "pre",
    "code",
    "a",
    "img",
    "iframe",
    // Only ever a TradingView placeholder — `exclusiveFilter` drops every other
    // <div>. <TradingViewEmbeds> turns it into the real widget in the browser.
    "div",
  ],
  allowedAttributes: {
    a: ["href", "title"],
    img: ["src", "alt", "width", "height", "style"],
    div: ["class", "data-tv-widget", "data-tv-symbol", "data-tv-theme"],
    iframe: [
      "src",
      "width",
      "height",
      "frameborder",
      "allowfullscreen",
      "allow",
      "style",
    ],
    // Quill's semantic HTML tags a code block with the picked language;
    // <HighlightCode> reads it on render.
    pre: ["data-language"],
  },
  // Image / video resize (quill-resize-image) writes an inline width; keep only
  // that, as a px or % value — never anything else from `style`.
  allowedStyles: {
    img: { width: [/^\d{1,4}px$/, /^\d{1,3}(\.\d+)?%$/] },
    iframe: { width: [/^\d{1,4}px$/, /^\d{1,3}(\.\d+)?%$/] },
  },
  // Text-alignment classes from Quill's class align attributor. `allowedClasses`
  // also whitelists the `class` attribute itself — nothing else survives.
  allowedClasses: {
    "*": ["ql-align-center", "ql-align-right", "ql-align-justify"],
    div: ["tv-embed"],
  },
  allowedSchemes: ["https", "mailto"],
  allowedSchemesByTag: { img: ["https"], iframe: ["https"] },
  // Only YouTube / Vimeo embeds — Quill's video button rewrites watch URLs to
  // exactly these hosts.
  allowedIframeHostnames: [
    "www.youtube.com",
    "www.youtube-nocookie.com",
    "player.vimeo.com",
  ],
  allowIframeRelativeUrls: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", {
      rel: "nofollow noopener noreferrer",
      target: "_blank",
    }),
  },
  exclusiveFilter: (frame) => {
    if (frame.tag === "img") {
      return !(
        SUPABASE_ORIGIN !== "" &&
        typeof frame.attribs.src === "string" &&
        frame.attribs.src.startsWith(`${SUPABASE_ORIGIN}/`)
      );
    }
    // Drop an iframe whose src was stripped for being off-host.
    if (frame.tag === "iframe") return !frame.attribs.src;
    // The only <div> that survives is a well-formed TradingView placeholder.
    if (frame.tag === "div") return !isValidTvEmbed(frame.attribs);
    return false;
  },
};

/** Sanitised HTML, safe to store and to render with dangerouslySetInnerHTML. */
export function sanitizeForumHtml(dirty: string): string {
  return sanitizeHtml(dirty ?? "", OPTIONS).trim();
}

/** Plain-text projection — used to reject a visually empty post. */
export function htmlToText(html: string): string {
  return sanitizeHtml(html ?? "", { allowedTags: [], allowedAttributes: {} })
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
