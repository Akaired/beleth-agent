import Link from "next/link";
import { IconCaretLeft, IconCaretRight } from "@/components/icons";
import { monthLabel, monthParam, shiftMonth } from "@/lib/month-grid";

/**
 * Prev / current / next month control shared by the market calendar and the
 * trade calendar. Plain links on `?month=YYYY-MM`; a disabled arrow is a span.
 */
export function MonthNav({
  basePath,
  year,
  month0,
  canPrev = true,
  canNext = true,
}: {
  basePath: string;
  year: number;
  month0: number;
  canPrev?: boolean;
  canNext?: boolean;
}) {
  const prev = shiftMonth(year, month0, -1);
  const next = shiftMonth(year, month0, 1);
  const arrow =
    "flex h-7 w-7 items-center justify-center rounded border border-line transition-colors";

  return (
    <div className="flex items-center gap-2">
      {canPrev ? (
        <Link
          href={`${basePath}?month=${monthParam(prev.year, prev.month0)}`}
          aria-label="Previous month"
          className={`${arrow} text-sec hover:text-txt hover:border-hoverline`}
        >
          <IconCaretLeft size={13} weight="bold" />
        </Link>
      ) : (
        <span className={`${arrow} text-faint`} aria-disabled>
          <IconCaretLeft size={13} weight="bold" />
        </span>
      )}
      <span className="min-w-[132px] text-center font-mono text-[12px] tracking-[0.06em] text-txt">
        {monthLabel(year, month0)}
      </span>
      {canNext ? (
        <Link
          href={`${basePath}?month=${monthParam(next.year, next.month0)}`}
          aria-label="Next month"
          className={`${arrow} text-sec hover:text-txt hover:border-hoverline`}
        >
          <IconCaretRight size={13} weight="bold" />
        </Link>
      ) : (
        <span className={`${arrow} text-faint`} aria-disabled>
          <IconCaretRight size={13} weight="bold" />
        </span>
      )}
    </div>
  );
}

export const WEEKDAY_LABELS = [
  "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
] as const;
