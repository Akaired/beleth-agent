"use client";

/**
 * Quill "snow" WYSIWYG for forum posts — full toolbar (headings, bold/italic/
 * underline/strike, lists, align left/center/right, blockquote, code block,
 * link, image, video, clear), laid out with a uniform gap so every control is
 * equidistant.
 *
 * - Link and Video open a centered <PromptDialog> (a real modal), not Quill's
 *   cramped inline tooltip. Video normalises a YouTube / Vimeo watch URL to an
 *   embed; the sanitiser then keeps the iframe only for those hosts.
 * - Image uploads through /api/forum/upload and embeds the returned URL.
 * - Code blocks get a language picker + live highlight.js highlighting (Quill's
 *   `syntax` module); stored HTML is `getSemanticHTML()`, re-highlighted on
 *   render by <HighlightCode>.
 * - Clicking an image / video shows corner drag handles + a live size readout
 *   (`quill-resize-image`); the chosen width is stored as inline `style`.
 * - Every toolbar click first gives the editor a caret, so a button always does
 *   something even from a cold start.
 *
 * The current HTML is mirrored into a hidden <input name={name}> so the parent
 * <form> submits it like any other field. Quill's JS is imported lazily inside
 * the effect so it never runs during SSR. The editor is built once and cleared
 * imperatively on `resetKey` (no teardown/rebuild — that would duplicate the
 * toolbar).
 */
import { useEffect, useRef, useState } from "react";
import type QuillType from "quill";
import type { Range as QuillRange } from "quill";
import "quill/dist/quill.snow.css";
import "highlight.js/styles/atom-one-dark.css";
import { PromptDialog } from "@/components/forum/prompt-dialog";
import {
  TradingViewDialog,
  type TvInsert,
} from "@/components/forum/tradingview-dialog";
import { TV_WIDGET_BY_ID } from "@/lib/forum/tradingview";

function toolbar(allowImages: boolean) {
  return [
    [{ header: [2, 3, false] }],
    ["bold", "italic", "underline", "strike"],
    [{ list: "ordered" }, { list: "bullet" }],
    [{ align: "" }, { align: "center" }, { align: "right" }],
    ["blockquote", "code-block"],
    allowImages
      ? ["link", "image", "video", "tradingview"]
      : ["link", "video", "tradingview"],
    ["clean"],
  ];
}

/** Toolbar glyph for the TradingView button — the official TradingView mark
 *  (simple-icons, CC0). `fill:currentColor` so it retints with the button. */
const TRADINGVIEW_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">' +
  '<path d="M15.8654 8.2789c0 1.3541-1.0978 2.4519-2.452 2.4519-1.354 ' +
  "0-2.4519-1.0978-2.4519-2.452 0-1.354 1.0978-2.4518 2.452-2.4518 1.3541 " +
  "0 2.4519 1.0977 2.4519 2.4519zM9.75 6H0v4.9038h4.8462v7.2692H9.75Zm8.5962 " +
  '0H24l-5.1058 12.173h-5.6538z"/>' +
  "</svg>";

const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";

/** A YouTube / Vimeo watch URL → its embed URL (anything else is returned as-is
 *  and then dropped by the sanitiser's host allowlist). */
function toEmbedUrl(raw: string): string {
  const yt = raw.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/,
  );
  if (yt) return `https://www.youtube.com/embed/${yt[1]}?showinfo=0`;
  const vm = raw.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}/`;
  return raw;
}

/** Give a bare "example.com" a scheme (the sanitiser only keeps https/mailto). */
function normalizeHref(raw: string): string {
  const v = raw.trim();
  if (/^(https?:|mailto:)/i.test(v)) return v;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`;
  return `https://${v.replace(/^\/+/, "")}`;
}

type PromptKind = "link" | "video" | null;

export function RichEditor({
  name,
  defaultValue = "",
  placeholder = "Write…",
  minHeight = 160,
  resetKey,
  allowImages = true,
}: {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  minHeight?: number;
  /** Change this to clear the editor (used after a successful post). */
  resetKey?: number;
  /** False drops the image button: the shared demo login may write, but an
   *  upload from it is an anonymous write to a public bucket (see 0030). */
  allowImages?: boolean;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const quillRef = useRef<QuillType | null>(null);
  const resizerObsRef = useRef<MutationObserver | null>(null);
  const savedRangeRef = useRef<QuillRange | null>(null);
  const firstResetRef = useRef(true);
  const [html, setHtml] = useState(defaultValue);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<PromptKind>(null);
  const [tvOpen, setTvOpen] = useState(false);

  // ── build the editor once ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const holder = holderRef.current;
    if (!holder || quillRef.current) return;

    (async () => {
      const [{ default: Quill }, { default: hljs }, resizeMod, { BlockEmbed }] =
        await Promise.all([
          import("quill"),
          import("highlight.js/lib/common"),
          import("quill-resize-image"),
          import("quill/blots/block"),
        ]);
      if (cancelled || !holderRef.current || quillRef.current) return;

      Quill.register(
        "modules/resize",
        (resizeMod as { default?: unknown }).default ?? resizeMod,
        true,
      );

      // Inert block placeholder for a TradingView widget. The editor shows a
      // labelled card; `getSemanticHTML()` emits only the bare
      // <div class="tv-embed" data-tv-*> that the sanitiser whitelists, and
      // <TradingViewEmbeds> turns that into the real widget on render.
      class TradingViewBlot extends BlockEmbed {
        static blotName = "tradingview";
        static tagName = "div";
        static className = "tv-embed";

        static create(value: TvInsert): HTMLElement {
          const node = super.create() as HTMLElement;
          node.setAttribute("data-tv-widget", value.widget);
          node.setAttribute("data-tv-symbol", value.symbol ?? "");
          node.setAttribute("data-tv-theme", value.theme ?? "dark");
          node.setAttribute("contenteditable", "false");
          const label = TV_WIDGET_BY_ID[value.widget]?.label ?? value.widget;
          node.innerHTML =
            '<span class="tv-embed-badge">TV</span>' +
            '<span class="tv-embed-text">TradingView — ' +
            label +
            (value.symbol ? " · " + value.symbol : "") +
            "</span>";
          return node;
        }

        static value(node: HTMLElement): TvInsert {
          return {
            widget: node.getAttribute("data-tv-widget") ?? "",
            symbol: node.getAttribute("data-tv-symbol") ?? "",
            theme:
              node.getAttribute("data-tv-theme") === "light" ? "light" : "dark",
          } as TvInsert;
        }

        html(): string {
          const v = TradingViewBlot.value(this.domNode);
          return (
            '<div class="tv-embed" data-tv-widget="' +
            v.widget +
            '" data-tv-symbol="' +
            v.symbol +
            '" data-tv-theme="' +
            v.theme +
            '"></div>'
          );
        }
      }
      Quill.register(TradingViewBlot, true);

      // Store text alignment as a class (`ql-align-center`) rather than an
      // inline style, so the sanitiser can allow it with a tight allowlist.
      Quill.register(
        "formats/align",
        Quill.import("attributors/class/align"),
        true,
      );

      // Quill's default "clear formatting" glyph (a tiny "Tx") reads as nothing.
      // Swap in an eraser — the universal "clear formatting" icon (Lucide, MIT).
      const icons = Quill.import("ui/icons") as Record<string, string>;
      icons.clean =
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" ' +
        'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
        'stroke-linejoin="round">' +
        '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0' +
        'l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/>' +
        '<path d="M22 21H7"/><path d="m5 11 9 9"/></svg>';
      icons.tradingview = TRADINGVIEW_ICON;

      const uploadImage = async () => {
        const q = quillRef.current;
        const range = q?.getSelection(true) ?? { index: q?.getLength() ?? 0 };
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ACCEPT;
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file || !q) return;
          setUploadError(null);
          const fd = new FormData();
          fd.set("file", file);
          try {
            const res = await fetch("/api/forum/upload", {
              method: "POST",
              body: fd,
            });
            const payload = (await res.json().catch(() => ({}))) as {
              url?: string;
              error?: string;
            };
            if (!res.ok || !payload.url) {
              throw new Error(payload.error ?? `Upload failed (${res.status})`);
            }
            q.insertEmbed(range.index, "image", payload.url, "user");
            q.setSelection(range.index + 1, 0);
          } catch (err) {
            setUploadError(
              err instanceof Error ? err.message : "Image upload failed.",
            );
          }
        };
        input.click();
      };

      const openPrompt = (kind: "link" | "video") => {
        const q = quillRef.current;
        if (!q) return;
        if (!q.getSelection()) {
          q.focus();
          q.setSelection(q.getLength(), 0);
        }
        const range = q.getSelection() ?? { index: q.getLength(), length: 0 };
        if (kind === "link" && q.getFormat(range).link) {
          q.format("link", false, "user"); // toggle an existing link off
          return;
        }
        savedRangeRef.current = range;
        setPrompt(kind);
      };

      const openTvDialog = () => {
        const q = quillRef.current;
        if (!q) return;
        if (!q.getSelection()) {
          q.focus();
          q.setSelection(q.getLength(), 0);
        }
        savedRangeRef.current = q.getSelection() ?? {
          index: q.getLength(),
          length: 0,
        };
        setTvOpen(true);
      };

      const quill = new Quill(holderRef.current, {
        theme: "snow",
        placeholder,
        modules: {
          syntax: { hljs },
          resize: { locale: {} },
          toolbar: {
            container: toolbar(allowImages),
            handlers: {
              image: uploadImage,
              link: () => openPrompt("link"),
              video: () => openPrompt("video"),
              tradingview: openTvDialog,
            },
          },
        },
      });

      if (defaultValue) {
        quill.clipboard.dangerouslyPasteHTML(defaultValue);
      }

      const sync = () => {
        const semantic = quill.getSemanticHTML();
        const hasText = /\S/.test(semantic.replace(/<[^>]+>/g, ""));
        const hasEmbed = /<(img|iframe)\b|class="tv-embed"/i.test(semantic);
        setHtml(hasText || hasEmbed ? semantic : "");
      };
      sync();
      quill.on("text-change", sync);
      quillRef.current = quill;

      // Every toolbar click should do something: if the editor has no caret
      // yet, give it one before the format handler runs.
      const toolbarEl = (
        quill.getModule("toolbar") as { container: HTMLElement }
      ).container;
      const caretGuard = () => {
        if (!quill.hasFocus() && quill.getSelection() == null) {
          quill.focus();
          quill.setSelection(quill.getLength(), 0);
        }
      };
      toolbarEl.addEventListener("mousedown", caretGuard, true);

      // quill-resize-image leaves its #editor-resizer overlay ("il reticolo")
      // on screen when the image / iframe it was attached to is deleted — it
      // only tears down on an outside mousedown. Watch for a removed embed and
      // fire that mousedown ourselves so the module cleans up its own overlay.
      const obs = new MutationObserver((mutations) => {
        if (!document.getElementById("editor-resizer")) return;
        const embedRemoved = mutations.some((m) =>
          Array.from(m.removedNodes).some(
            (n) =>
              n.nodeType === 1 &&
              (/^(IMG|IFRAME|VIDEO)$/.test((n as Element).tagName) ||
                Boolean((n as Element).querySelector?.("img, iframe, video"))),
          ),
        );
        if (embedRemoved) {
          quill.root.dispatchEvent(
            new MouseEvent("mousedown", { bubbles: true }),
          );
        }
      });
      obs.observe(quill.root, { childList: true, subtree: true });
      resizerObsRef.current = obs;
    })();

    return () => {
      cancelled = true;
    };
    // allowImages only shapes the toolbar built on this one pass; it is fixed
    // for the lifetime of a mount (it comes from the viewer's role).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValue, placeholder]);

  // ── clear on resetKey (no rebuild) ──────────────────────────────────────
  useEffect(() => {
    if (firstResetRef.current) {
      firstResetRef.current = false;
      return;
    }
    quillRef.current?.setContents(
      [{ insert: "\n" }] as unknown as Parameters<
        NonNullable<typeof quillRef.current>["setContents"]
      >[0],
    );
    setHtml("");
  }, [resetKey]);

  // ── unmount ────────────────────────────────────────────────────────────
  useEffect(
    () => () => {
      resizerObsRef.current?.disconnect();
      resizerObsRef.current = null;
      document.getElementById("editor-resizer")?.remove();
    },
    [],
  );

  const applyPrompt = (value: string) => {
    const q = quillRef.current;
    const range = savedRangeRef.current;
    const kind = prompt;
    setPrompt(null);
    if (!q || !range) return;

    if (kind === "link") {
      const href = normalizeHref(value);
      if ((range.length ?? 0) === 0) {
        q.insertText(range.index, value, { link: href }, "user");
        q.setSelection(range.index + value.length, 0, "user");
      } else {
        q.formatText(range.index, range.length, { link: href }, "user");
        q.setSelection(range.index + range.length, 0, "user");
      }
    } else if (kind === "video") {
      q.insertEmbed(range.index, "video", toEmbedUrl(value.trim()), "user");
      q.setSelection(range.index + 1, 0, "user");
    }
  };

  const applyTv = (value: TvInsert) => {
    const q = quillRef.current;
    const range = savedRangeRef.current;
    setTvOpen(false);
    if (!q || !range) return;
    q.insertEmbed(range.index, "tradingview", value, "user");
    q.setSelection(range.index + 1, 0, "user");
  };

  return (
    <div className="forum-editor">
      <div ref={holderRef} style={{ minHeight }} />
      <input type="hidden" name={name} value={html} readOnly />
      {uploadError && (
        <p className="mt-1 text-[11.5px] text-down">{uploadError}</p>
      )}

      <PromptDialog
        open={prompt === "link"}
        title="Add link"
        label="URL"
        inputType="url"
        placeholder="https://example.com"
        confirmLabel="Add link"
        onConfirm={applyPrompt}
        onCancel={() => setPrompt(null)}
      />
      <PromptDialog
        open={prompt === "video"}
        title="Embed video"
        label="YouTube or Vimeo URL"
        inputType="url"
        placeholder="https://www.youtube.com/watch?v=…"
        confirmLabel="Embed"
        hint="Only YouTube and Vimeo links can be embedded."
        onConfirm={applyPrompt}
        onCancel={() => setPrompt(null)}
      />
      <TradingViewDialog
        open={tvOpen}
        onConfirm={applyTv}
        onCancel={() => setTvOpen(false)}
      />
    </div>
  );
}
