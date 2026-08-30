"use client";

/**
 * Re-highlights every <pre> inside the rendered post bodies with highlight.js,
 * using the language Quill stored in `data-language` (falling back to
 * auto-detect). Runs on mount and whenever `signature` changes (a post was
 * edited). highlight.js is imported lazily so it stays out of the initial
 * bundle; a brief flash of un-highlighted monospace before it lands is fine.
 */
import { useEffect } from "react";
import "highlight.js/styles/atom-one-dark.css";

export function HighlightCode({ signature }: { signature: string }) {
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { default: hljs } = await import("highlight.js/lib/common");
      if (cancelled) return;
      document
        .querySelectorAll<HTMLElement>(".forum-prose pre")
        .forEach((pre) => {
          if (pre.dataset.highlighted === "yes") return;
          const code = pre.textContent ?? "";
          const lang = pre.dataset.language;
          try {
            const out =
              lang && hljs.getLanguage(lang)
                ? hljs.highlight(code, { language: lang })
                : hljs.highlightAuto(code);
            pre.innerHTML = out.value;
            pre.classList.add("hljs");
            pre.dataset.highlighted = "yes";
          } catch {
            /* leave the code as plain monospace */
          }
        });
    })();
    return () => {
      cancelled = true;
    };
  }, [signature]);

  return null;
}
