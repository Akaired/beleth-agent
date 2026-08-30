import Link from "next/link";
import type { DocNavGroup } from "@/lib/docs/types";

/**
 * The grouped documentation index. Rendered server-side — the active page is
 * passed in as `currentSlug` so no client JS is needed. Reused (with a wrapper)
 * by the mobile drawer.
 */
export function DocsSideNav({
  groups,
  currentSlug,
  onNavigate,
}: {
  groups: DocNavGroup[];
  currentSlug: string;
  onNavigate?: () => void;
}) {
  const filled = groups.filter((g) => g.pages.length > 0);

  return (
    <nav className="flex flex-col gap-5">
      {filled.map((group) => (
        <div key={group.category.id}>
          <h2 className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-dim">
            {group.category.label}
          </h2>
          <div className="flex flex-col gap-0.5">
            {group.pages.map((p) => {
              const active = p.slug === currentSlug;
              return (
                <Link
                  key={p.id}
                  href={`/docs/${p.slug}`}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={`py-0.5 text-[13px] transition-colors ${
                    active
                      ? "font-medium text-acc"
                      : "text-sec hover:text-txt"
                  }`}
                >
                  {p.title}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
