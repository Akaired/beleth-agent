"use client";

import { useEffect, useRef, useState } from "react";
import type { DocNavGroup } from "@/lib/docs/types";
import { DocsSideNav } from "@/components/docs/docs-side-nav";
import { IconClose, IconMenu } from "@/components/icons";

/** The grouped index as a collapsible panel, for viewports without the rail. */
export function DocsMobileNav({
  groups,
  currentSlug,
  currentTitle,
}: {
  groups: DocNavGroup[];
  currentSlug: string;
  currentTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div ref={ref} className="relative lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-line bg-panel px-3 py-2.5 text-[13px] text-txt"
      >
        <span className="flex items-center gap-2">
          {open ? <IconClose size={14} /> : <IconMenu size={14} />}
          Browse docs
        </span>
        <span className="max-w-[55%] truncate text-sec">{currentTitle}</span>
      </button>
      {open && (
        <div className="absolute inset-x-0 top-[calc(100%+6px)] z-40 max-h-[60vh] overflow-y-auto rounded-md border border-line bg-panel p-4 shadow-lg">
          <DocsSideNav
            groups={groups}
            currentSlug={currentSlug}
            onNavigate={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
