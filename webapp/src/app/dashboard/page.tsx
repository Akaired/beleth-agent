import type { ReactNode } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { requireSession, roleAtLeast } from "@/lib/auth";
import { fetchDashboardOverview } from "@/lib/dashboard-queries";
import { daysLive } from "@/lib/queries";
import { EquityChart } from "@/components/dashboard/equity-chart";
import {
  ActionBadge,
  Panel,
  formatUsd,
  timeAgo,
} from "@/components/dashboard/ui";

export const metadata: Metadata = { title: "Overview — Beleth dashboard" };

function Stat({
  label,
  value,
  tone = "txt",
}: {
  label: string;
  value: ReactNode;
  tone?: "txt" | "up" | "down" | "acc";
}) {
  const c =
    tone === "up"
      ? "text-up"
      : tone === "down"
        ? "text-down"
        : tone === "acc"
          ? "text-acc"
          : "text-txt";
  return (
    <div>
      <div className={`font-mono text-[22px] leading-none ${c}`}>{value}</div>
      <div className="mt-1.5 text-[11px] text-sec">{label}</div>
    </div>
  );
}

export default async function DashboardOverview() {
  const ctx = await requireSession();
  const d = await fetchDashboardOverview();
  const latest = d.latestDecision;
  const dayPnl = latest ? Number(latest.day_pnl) : 0;
  const equity = latest ? Number(latest.equity) : 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-[18px] font-serif font-light">Overview</h1>
        <span className="font-mono text-[10.5px] text-dim">
          cycle {timeAgo(d.agentStatus?.last_cycle_at ?? null)}
        </span>
      </div>

      {d.agentStatus?.paused && (
        <div className="border border-killline bg-blocked/15 rounded px-3 py-2 font-mono text-[11px] tracking-[0.06em] text-down">
          AGENT PAUSED — the master-admin kill switch is engaged. No new
          decisions are being produced.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-5 border border-line rounded-md bg-panel p-5">
        <Stat label="Equity" value={formatUsd(equity, 0)} />
        <Stat
          label="Day P&L"
          value={formatUsd(dayPnl, 0)}
          tone={dayPnl > 0 ? "up" : dayPnl < 0 ? "down" : "txt"}
        />
        <Stat label="Open positions" value={d.openPositions} />
        <Stat label="Days live" value={daysLive(d.firstDecisionAt)} />
        <Stat label="Cycles run" value={d.cyclesRun} />
        <Stat label="Trades submitted" value={d.tradesSubmitted} />
        <Stat
          label="Refused by risk checks"
          value={d.refused}
          tone="acc"
        />
        <Stat
          label="Agent state"
          value={
            <span className="font-mono text-[12px]">
              {(d.agentStatus?.state ?? "unknown").replace(/_/g, " ")}
            </span>
          }
        />
      </div>

      <Panel title="Equity curve">
        <EquityChart points={d.equitySeries} />
      </Panel>

      <Panel
        title="Latest decision"
        right={
          latest ? <ActionBadge action={latest.action} /> : undefined
        }
      >
        {latest ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10.5px] text-dim">
              <span>{latest.symbol}</span>
              <span>{new Date(latest.created_at).toLocaleString()}</span>
              <span>source: {latest.decision_source}</span>
              {latest.llm_model && <span>{latest.llm_model}</span>}
              <span>{latest.market_open ? "market open" : "market closed"}</span>
            </div>
            <p className="text-[13px] text-txt leading-relaxed">
              {latest.summary}
            </p>
            {roleAtLeast(ctx.role, "demo_admin") && (
              <Link
                href={`/dashboard/decisions/${latest.id}`}
                className="text-[12px] text-acc hover:underline w-fit"
              >
                Full detail, risk checks & LLM reasoning →
              </Link>
            )}
          </div>
        ) : (
          <p className="text-[13px] text-sec">No decisions recorded yet.</p>
        )}
      </Panel>

      <Panel title="Recent decisions">
        <ul className="flex flex-col divide-y divide-rowline -my-1">
          {d.recentDecisions.map((row) => {
            const inner = (
              <div className="flex items-start gap-3 py-2">
                <span className="font-mono text-[10px] text-dim w-[92px] shrink-0 pt-0.5">
                  {timeAgo(row.created_at)}
                </span>
                <span className="shrink-0 pt-0.5">
                  <ActionBadge action={row.action} />
                </span>
                <span className="text-[12px] text-sec leading-snug line-clamp-2">
                  {row.summary}
                </span>
              </div>
            );
            return (
              <li key={row.id}>
                {roleAtLeast(ctx.role, "demo_admin") ? (
                  <Link
                    href={`/dashboard/decisions/${row.id}`}
                    className="block hover:bg-hoverbg -mx-2 px-2 rounded transition-colors"
                  >
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
          {d.recentDecisions.length === 0 && (
            <li className="py-2 text-[12px] text-dim">Nothing yet.</li>
          )}
        </ul>
      </Panel>
    </div>
  );
}
