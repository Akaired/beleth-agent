import Link from "next/link";
import type { Metadata } from "next";
import { requireSession, roleAtLeast } from "@/lib/auth";
import { fetchEventLog } from "@/lib/dashboard-queries";
import { ForbiddenPanel } from "@/components/dashboard/ui";
import { EventList } from "@/components/dashboard/event-list";
import { LOGS_PAGE_SIZE } from "@/lib/pagination";
import {
  DEFAULT_RANGE,
  EVENT_FILTER_SLUGS,
  RANGE_PRESETS,
  eventLabel,
  rangeSince,
} from "@/lib/events";
import {
  IconCaretLeft,
  IconCaretRight,
  IconFilter,
  IconLogs,
} from "@/components/icons";

export const metadata: Metadata = { title: "Logs — Beleth backoffice" };


function toArray(v: string | string[] | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export default async function LogsPage({
  searchParams,
}: PageProps<"/dashboard/logs">) {
  const ctx = await requireSession();
  if (!roleAtLeast(ctx.role, "demo_admin")) return <ForbiddenPanel />;

  const sp = await searchParams;
  const page = Math.max(1, Number(sp?.page) || 1);
  const selected = toArray(sp?.event).filter((e) =>
    EVENT_FILTER_SLUGS.includes(e),
  );
  const rawRange = Array.isArray(sp?.range) ? sp.range[0] : sp?.range;
  const range =
    RANGE_PRESETS.find((r) => r.key === rawRange)?.key ?? DEFAULT_RANGE;

  const { rows, total } = await fetchEventLog({
    page,
    pageSize: LOGS_PAGE_SIZE,
    events: selected,
    since: rangeSince(range),
  });
  const pages = Math.max(1, Math.ceil(total / LOGS_PAGE_SIZE));

  // Build a query string from the current state with overrides applied.
  const qs = (o: {
    page?: number;
    range?: string;
    event?: string[];
  }) => {
    const p = new URLSearchParams();
    for (const e of o.event ?? selected) p.append("event", e);
    const r = o.range ?? range;
    if (r !== DEFAULT_RANGE) p.set("range", r);
    const pg = o.page ?? 1;
    if (pg > 1) p.set("page", String(pg));
    const s = p.toString();
    return s ? `?${s}` : "";
  };

  const toggleEvent = (slug: string) =>
    selected.includes(slug)
      ? selected.filter((s) => s !== slug)
      : [...selected, slug];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="flex items-center gap-2 text-[18px] font-light">
          <IconLogs size={17} weight="bold" className="text-acc" />
          Logs
        </h1>
        <span className="font-mono text-[10.5px] text-dim">
          {total} event{total === 1 ? "" : "s"} · page {page}/{pages}
        </span>
      </div>

      {/* range */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-dim mr-1">
          Window
        </span>
        {RANGE_PRESETS.map((r) => {
          const on = r.key === range;
          return (
            <Link
              key={r.key}
              href={`/dashboard/logs${qs({ range: r.key })}`}
              className={`rounded px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors ${
                on ? "bg-chipbg text-txt" : "text-dim hover:text-sec"
              }`}
            >
              {r.label}
            </Link>
          );
        })}
      </div>

      {/* event filter */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.08em] text-dim mr-1">
          <IconFilter size={11} />
          Event
        </span>
        {selected.length > 0 && (
          <Link
            href={`/dashboard/logs${qs({ event: [] })}`}
            className="rounded px-2 py-1 font-mono text-[10px] uppercase tracking-[0.06em] text-acc hover:underline"
          >
            clear ({selected.length})
          </Link>
        )}
        {EVENT_FILTER_SLUGS.map((slug) => {
          const on = selected.includes(slug);
          return (
            <Link
              key={slug}
              href={`/dashboard/logs${qs({ event: toggleEvent(slug) })}`}
              className={`rounded border px-2 py-1 font-mono text-[10px] tracking-[0.03em] transition-colors ${
                on
                  ? "border-emphline bg-chipbg text-txt"
                  : "border-line text-dim hover:text-sec hover:border-emphline"
              }`}
            >
              {eventLabel(slug)}
            </Link>
          );
        })}
      </div>

      <div className="border border-line rounded-md bg-panel p-4">
        <EventList
          rows={rows}
          emptyText="No events match these filters."
        />
      </div>

      <div className="flex items-center justify-between font-mono text-[11px]">
        {page > 1 ? (
          <Link
            href={`/dashboard/logs${qs({ page: page - 1 })}`}
            className="flex items-center gap-1 text-acc hover:underline"
          >
            <IconCaretLeft size={12} weight="bold" /> newer
          </Link>
        ) : (
          <span className="flex items-center gap-1 text-faint">
            <IconCaretLeft size={12} weight="bold" /> newer
          </span>
        )}
        {page < pages ? (
          <Link
            href={`/dashboard/logs${qs({ page: page + 1 })}`}
            className="flex items-center gap-1 text-acc hover:underline"
          >
            older <IconCaretRight size={12} weight="bold" />
          </Link>
        ) : (
          <span className="flex items-center gap-1 text-faint">
            older <IconCaretRight size={12} weight="bold" />
          </span>
        )}
      </div>
    </div>
  );
}
