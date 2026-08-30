"use client";

import { useState } from "react";
import { IconCheck, IconCopy } from "@/components/icons";

/** Fetches the page's raw Markdown (`/docs/md/<slug>`) and copies it. */
export function CopyForLlm({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      const res = await fetch(`/docs/md/${slug}`);
      if (!res.ok) return;
      await navigator.clipboard.writeText(await res.text());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard/network failure is non-critical — the button just won't confirm */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded border border-line px-2.5 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-sec transition-colors hover:border-hoverline hover:text-txt"
    >
      {copied ? (
        <IconCheck size={12} className="text-up" />
      ) : (
        <IconCopy size={12} />
      )}
      {copied ? "Copied" : "Copy for LLM"}
    </button>
  );
}
