import type { Metadata } from "next";
import { requireSession, roleAtLeast } from "@/lib/auth";
import { fetchMarketCalendarView } from "@/lib/dashboard-queries";
import { ForbiddenPanel } from "@/components/dashboard/ui";
import { MonthNav, WEEKDAY_LABELS } from "@/components/dashboard/month-nav";
import { formatWeekdayTime } from "@/lib/format";
import {
  monthMatrix,
  nyToday,
  parseMonthParam,
} from "@/lib/month-grid";
import {
  classifyDay,
  sessionRange,
  type MarketCalendarDay,
} from "@/lib/market-calendar";
import {
  IconMarketCalendar,
  IconSun,
  IconWarning,
} from "@/components/icons";

export const metadata: Metadata = { title: "Calendar — Beleth backoffice" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function Chip({
  tone,
  children,
}: {
  tone: "open" | "closed" | "early";
  children: React.ReactNode;
}) {
  const cls =
    tone === "open"
      ? "bg-up/15 text-up"
      : tone === "early"
        ? "bg-acc/15 text-acc"
        : "bg-chipbg text-sec";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.08em] ${cls}`}
    >
      {children}
    </span>
  );
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const ctx = await requireSession();
  if (!roleAtLeast(ctx.role, "demo_admin")) return <ForbiddenPanel />;

  const sp = await searchParams;
  const raw = Array.isArray(sp?.month) ? sp.month[0] : sp?.month;
  const today = nyToday();
  const { year, month0 } = parseMonthParam(raw) ?? {
    year: today.year,
    month0: today.month0,
  };

  const { days, clock, alpacaOk } = await fetchMarketCalendarView(year, month0);
  const byDate = new Map<string, MarketCalendarDay>(
    days.map((d) => [d.date, d]),
  );
  const weeks = monthMatrix(year, month0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="flex items-center gap-2 text-[18px] font-light">
          <IconMarketCalendar size={17} weight="bold" className="text-acc" />
          Calendar
        </h1>
        <span className="font-mono text-[10.5px] text-dim">
          US equity market — regular sessions, half days &amp; holidays
        </span>
      </div>

      {/* Live clock strip */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-line bg-panel px-4 py-3">
        <span className="flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              clock?.isOpen ? "bg-up" : "bg-dim"
            }`}
          />
          <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-txt">
            {clock == null
              ? "market status unavailable"
              : clock.isOpen
                ? "Market open"
                : "Market closed"}
          </span>
        </span>
        {clock && (
          <span className="font-mono text-[10.5px] text-dim">
            {clock.isOpen ? "Next close" : "Next open"}:{" "}
            <span className="text-sec">
              {formatWeekdayTime(clock.isOpen ? clock.nextClose : clock.nextOpen)}
            </span>
          </span>
        )}
        <span className="ml-auto">
          <MonthNav basePath="/dashboard/calendar" year={year} month0={month0} />
        </span>
      </div>

      {!alpacaOk && (
        <div className="flex items-start gap-2 rounded-md border border-killline/60 bg-panel px-4 py-3 text-[12px] text-sec">
          <IconWarning size={15} className="mt-0.5 shrink-0 text-down" />
          <p>
            The trading calendar from Alpaca is unavailable right now. Weekdays
            are shown as tentative sessions; half days and holidays cannot be
            marked.
          </p>
        </div>
      )}

      {/* Grid */}
      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-7 border-b border-line bg-table-head">
            {WEEKDAY_LABELS.map((d) => (
              <div
                key={d}
                className="px-2 py-2 text-center font-mono text-[9.5px] uppercase tracking-[0.1em] text-sec"
              >
                {d}
              </div>
            ))}
          </div>
          {weeks.map((row, wi) => (
            <div
              key={wi}
              className="grid grid-cols-7 border-b border-rowline last:border-b-0"
            >
              {row.map((g) => {
                const { kind, day } = classifyDay(g.iso, g.dow, byDate);
                const isWeekend = g.dow === 0 || g.dow === 6;
                const isToday = g.iso === today.iso;
                return (
                  <div
                    key={g.iso}
                    className={`min-h-[76px] border-r border-rowline px-2 py-1.5 last:border-r-0 ${
                      g.inMonth ? "" : "opacity-35"
                    } ${isToday ? "bg-acc/8" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className={`font-mono text-[11px] ${
                          isToday
                            ? "flex h-5 w-5 items-center justify-center rounded-full bg-acc font-medium text-bg"
                            : g.inMonth
                              ? "text-txt"
                              : "text-dim"
                        }`}
                      >
                        {g.day}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-col gap-1">
                      {kind === "open" && day && (
                        <>
                          <Chip tone="open">open</Chip>
                          <span className="font-mono text-[9px] leading-tight text-dim">
                            {sessionRange(day.open, day.close)}
                          </span>
                        </>
                      )}
                      {kind === "early" && day && (
                        <>
                          <Chip tone="early">
                            <IconSun size={9} weight="bold" /> early
                          </Chip>
                          <span className="font-mono text-[9px] leading-tight text-acc/80">
                            {sessionRange(day.open, day.close)}
                          </span>
                        </>
                      )}
                      {kind === "closed" &&
                        (alpacaOk ? (
                          <Chip tone="closed">
                            {isWeekend ? "weekend" : "holiday"}
                          </Chip>
                        ) : isWeekend ? (
                          <Chip tone="closed">weekend</Chip>
                        ) : (
                          <span className="font-mono text-[9px] text-faint">
                            —
                          </span>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 font-mono text-[10px] text-dim">
        <span className="flex items-center gap-1.5">
          <Chip tone="open">open</Chip> regular session, 9:30 AM – 4:00 PM ET
        </span>
        <span className="flex items-center gap-1.5">
          <Chip tone="early">
            <IconSun size={9} weight="bold" /> early
          </Chip>{" "}
          half day, close at 1:00 PM ET
        </span>
        <span className="flex items-center gap-1.5">
          <Chip tone="closed">holiday</Chip> exchange closed
        </span>
      </div>
    </div>
  );
}
