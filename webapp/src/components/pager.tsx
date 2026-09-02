import Link from "next/link";
import { IconCaretLeft, IconCaretRight } from "@/components/icons";

/**
 * Newer / older paging, shared by the decision history, the log, the positions history
 * and the forum's topic lists. It was the same twenty-six lines in each, differing only
 * in how the href was built and whether the page counter sat in the middle.
 *
 * `href` takes a page number and returns the link for it — every caller already has a
 * `qs()` helper of its own shape, so the component never assumes a query format.
 */
export function Pager({
  page,
  pages,
  href,
  showCount = true,
}: {
  page: number;
  pages: number;
  href: (page: number) => string;
  /** The `page n/m` counter between the two links. Off where a header already says it. */
  showCount?: boolean;
}) {
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between font-mono text-[11px]">
      <Step
        to={page > 1 ? href(page - 1) : null}
        label="newer"
        icon={<IconCaretLeft size={12} weight="bold" />}
      />
      {showCount && (
        <span className="text-dim">
          page {page}/{pages}
        </span>
      )}
      <Step
        to={page < pages ? href(page + 1) : null}
        label="older"
        icon={<IconCaretRight size={12} weight="bold" />}
        trailingIcon
      />
    </div>
  );
}

/** One end of the pager. A `null` target renders the same shape, dimmed and inert. */
function Step({
  to,
  label,
  icon,
  trailingIcon = false,
}: {
  to: string | null;
  label: string;
  icon: React.ReactNode;
  trailingIcon?: boolean;
}) {
  const body = trailingIcon ? (
    <>
      {label} {icon}
    </>
  ) : (
    <>
      {icon} {label}
    </>
  );
  return to ? (
    <Link href={to} className="flex items-center gap-1 text-acc hover:underline">
      {body}
    </Link>
  ) : (
    <span className="flex items-center gap-1 text-faint">{body}</span>
  );
}
