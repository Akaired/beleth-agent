import type { Metadata } from "next";
import { requireSession, roleAtLeast } from "@/lib/auth";
import { fetchTradeCalendar } from "@/lib/dashboard-queries";
import {
  ForbiddenPanel,
  Metric,
  formatUsd,
} from "@/components/dashboard/ui";
import { MonthNav, WEEKDAY_LABELS } from "@/components/dashboard/month-nav";
import {
  monthParam,
  nyToday,
  parseMonthParam,
  shiftMonth,
} from "@/lib/month-grid";
import { buildTradeCalendar } from "@/lib/trade-calendar";
import { IconTradeCalendar, IconWarning } from "@/components/icons";

export const metadata: Metadata = { title: "Trade calendar — Beleth backoffice" };

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function signedUsd(n: number): string {
  const s = formatUsd(Math.abs(n), 2);
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}

/** Background + text tint for a P&L figure — green up, red down, muted flat. */
function tint(pnl: number, hasTrades: boolean): string {
  if (!hasTrades) return "bg-inset/30";
  if (pnl > 0) return "bg-up/10";
  if (pnl < 0) return "bg-down/10";
  return "bg-chipbg/40";
}

function pnlText(pnl: number, hasTrades: boolean): string {
  if (!hasTrades) return "text-faint";
  return pnl > 0 ? "text-up" : pnl < 0 ? "text-down" : "text-sec";
}

export default async function TradeCalendarPage({
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

  const { days, firstDate, alpacaOk } = await fetchTradeCalendar();
  const cal = buildTradeCalendar(days, year, month0, today.iso);

  const prev = shiftMonth(year, month0, -1);
  const next = shiftMonth(year, month0, 1);
  const todayMp = monthParam(today.year, today.month0);
  const canPrev = firstDate
    ? monthParam(prev.year, prev.month0) >= firstDate.slice(0, 7)
    : true;
  const canNext = monthParam(next.year, next.month0) <= todayMp;

  const netTone =
    cal.totalPnl > 0 ? "text-up" : cal.totalPnl < 0 ? "text-down" : "text-sec";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="flex items-center gap-2 text-[18px] font-light">
          <IconTradeCalendar size={17} weight="bold" className="text-acc" />
          Trade calendar
        </h1>
        <span className="font-mono text-[10.5px] text-dim">
          Closed spreads by exit day · realised P&amp;L
        </span>
      </div>

      {/* Month summary + nav */}
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-md border border-line bg-panel px-4 py-3">
        <Metric size="md" label="Trades" value={String(cal.totalTrades)} />
        <Metric size="md" label="Net P&L" value={signedUsd(cal.totalPnl)} tone={netTone} />
        <Metric size="md"
          label="Days"
          value={`${cal.winningDays}W · ${cal.losingDays}L`}
          tone="text-sec"
        />
        <span className="ml-auto">
          <MonthNav
            basePath="/dashboard/trade-calendar"
            year={year}
            month0={month0}
            canPrev={canPrev}
            canNext={canNext}
          />
        </span>
      </div>

      {!alpacaOk && (
        <div className="flex items-start gap-2 rounded-md border border-killline/60 bg-panel px-4 py-3 text-[12px] text-sec">
          <IconWarning size={15} className="mt-0.5 shrink-0 text-down" />
          <p>
            Closed-trade history from Alpaca is unavailable right now — the grid
            below may be incomplete.
          </p>
        </div>
      )}

      {/* Grid */}
      <div className="overflow-x-auto rounded-md border border-line bg-panel">
        <table className="w-full min-w-[720px] table-fixed border-collapse">
          <colgroup>
            {WEEKDAY_LABELS.map((d) => (
              <col key={d} className="w-[12.5%]" />
            ))}
            <col className="w-[12.5%]" />
          </colgroup>
          <thead className="bg-table-head">
            <tr>
              {WEEKDAY_LABELS.map((d) => (
                <th
                  key={d}
                  className="border-b border-line px-2 py-2 text-center font-mono text-[9.5px] uppercase tracking-[0.1em] text-sec"
                >
                  {d}
                </th>
              ))}
              <th className="border-b border-l border-line px-2 py-2 text-center font-mono text-[9.5px] uppercase tracking-[0.1em] text-acc">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {cal.weeks.map((wk, wi) => (
              <tr key={wi}>
                {wk.cells.map((c) => {
                  const has = c.trades > 0;
                  return (
                    <td
                      key={c.iso}
                      className={`h-[84px] border-b border-r border-rowline align-top ${
                        c.inMonth ? tint(c.realizedPnl, has) : "bg-transparent"
                      } ${c.isToday ? "outline outline-1 -outline-offset-1 outline-acc/50" : ""}`}
                    >
                      {c.inMonth && (
                        <div className="flex h-full flex-col px-2 py-1.5">
                          <span
                            className={`font-mono text-[10px] ${
                              c.isToday ? "text-acc" : "text-dim"
                            }`}
                          >
                            {c.day}
                          </span>
                          {has ? (
                            <div className="mt-auto flex flex-col gap-0.5">
                              <span className="font-mono text-[10px] text-sec">
                                {c.trades} trade{c.trades === 1 ? "" : "s"}
                              </span>
                              <span
                                className={`font-mono text-[11.5px] ${pnlText(
                                  c.realizedPnl,
                                  has,
                                )}`}
                              >
                                {signedUsd(c.realizedPnl)}
                              </span>
                            </div>
                          ) : (
                            <span className="mt-auto font-mono text-[10px] text-faint">
                              —
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
                {/* Weekly total */}
                <td
                  className={`h-[84px] border-b border-l border-rowline align-top ${tint(
                    wk.realizedPnl,
                    wk.trades > 0,
                  )}`}
                >
                  <div className="flex h-full flex-col justify-center px-2 py-1.5">
                    <span className="font-mono text-[10px] text-sec">
                      {wk.trades} trade{wk.trades === 1 ? "" : "s"}
                    </span>
                    <span
                      className={`font-mono text-[12px] ${pnlText(
                        wk.realizedPnl,
                        wk.trades > 0,
                      )}`}
                    >
                      {signedUsd(wk.realizedPnl)}
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-panel-head">
              <td
                colSpan={7}
                className="border-t border-line px-3 py-2.5 text-right font-mono text-[10px] uppercase tracking-[0.1em] text-sec"
              >
                {cal.totalTrades} trade{cal.totalTrades === 1 ? "" : "s"} this
                month
              </td>
              <td
                className={`border-l border-t border-line px-2 py-2.5 text-center font-mono text-[12px] ${netTone}`}
              >
                {signedUsd(cal.totalPnl)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="font-mono text-[10px] text-faint">
        A trade is one closed vertical spread, counted on its exit-fill date
        (US/Eastern). Open positions and rejected orders are not shown — see
        Positions.
      </p>
    </div>
  );
}
