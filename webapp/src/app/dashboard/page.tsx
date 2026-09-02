import type { ComponentType, ReactNode } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { requireSession, roleAtLeast, isMasterAdmin } from "@/lib/auth";
import { fetchDashboardOverview } from "@/lib/dashboard-queries";
import { daysLive } from "@/lib/queries";
import { EquityCurve } from "@/components/equity-curve";
import { MarketChip } from "@/components/market-chip";
import { TickerBadge } from "@/components/ticker-badge";
import {
  ActionBadge,
  Panel,
  formatUsd,
  timeAgo,
} from "@/components/dashboard/ui";
import {
  IconArrowRight,
  IconOverview,
  IconCalendar,
  IconCycles,
  IconEquity,
  IconPositions,
  IconPulse,
  IconRefused,
  IconTrades,
  IconTrendDown,
  IconTrendUp,
  IconWarning,
} from "@/components/icons";

export const metadata: Metadata = { title: "Overview — Beleth dashboard" };

type IconType = ComponentType<{
  size?: number;
  weight?: "regular" | "bold" | "fill";
  className?: string;
}>;

function AcctField({
  label,
  value,
  tone = "txt",
}: {
  label: string;
  value: ReactNode;
  tone?: "txt" | "sec" | "up" | "down" | "acc";
}) {
  const c =
    tone === "up"
      ? "text-up"
      : tone === "down"
        ? "text-down"
        : tone === "acc"
          ? "text-acc"
          : tone === "sec"
            ? "text-sec"
            : "text-txt";
  return (
    <div>
      <div className="text-[10.5px] uppercase tracking-[0.08em] text-dim">
        {label}
      </div>
      <div className={`mt-1 font-mono text-[13px] leading-tight ${c}`}>
        {value}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  Icon,
  tone = "txt",
}: {
  label: string;
  value: ReactNode;
  Icon: IconType;
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
      <div className="flex items-center gap-1.5 text-[11px] text-sec">
        <Icon size={13} className="text-dim" />
        {label}
      </div>
      <div className={`mt-1.5 font-mono text-[22px] leading-none ${c}`}>{value}</div>
    </div>
  );
}

export default async function DashboardOverview() {
  const ctx = await requireSession();
  const d = await fetchDashboardOverview();
  const latest = d.latestDecision;
  // Prefer the live Alpaca account balances; fall back to the last decision row
  // the agent persisted if the account call failed.
  const equity =
    d.account?.equity ?? (latest ? Number(latest.equity) : 0);
  const dayPnl =
    d.account?.dayPnl ?? (latest ? Number(latest.day_pnl) : 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="flex items-center gap-2 text-[18px] font-light">
          <IconOverview size={17} weight="bold" className="text-acc" />
          Overview
        </h1>
        <div className="flex items-center gap-3">
          <MarketChip open={d.marketOpen} />
          <span className="font-mono text-[10.5px] text-dim">
            cycle {timeAgo(d.agentStatus?.last_cycle_at ?? null)}
          </span>
        </div>
      </div>

      {d.agentStatus?.paused && (
        <div className="flex items-center justify-between gap-3 rounded border border-killline bg-blocked/15 px-3 py-2 font-mono text-[11px] tracking-[0.06em] text-down">
          <span className="flex items-center gap-2">
            <IconWarning size={14} weight="fill" className="shrink-0" />
            AGENT PAUSED — the master-admin kill switch is engaged. No new
            decisions are being produced.
          </span>
          {isMasterAdmin(ctx.role) && (
            <Link
              href="/dashboard/controls"
              className="flex shrink-0 items-center gap-1 underline"
            >
              Manage <IconArrowRight size={12} weight="bold" />
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-5 border border-line rounded-md bg-panel p-5">
        <Stat label="Equity" Icon={IconEquity} value={formatUsd(equity, 0)} />
        <Stat
          label="Day P&L"
          Icon={dayPnl < 0 ? IconTrendDown : IconTrendUp}
          value={formatUsd(dayPnl, 0)}
          tone={dayPnl > 0 ? "up" : dayPnl < 0 ? "down" : "txt"}
        />
        <Stat label="Open positions" Icon={IconPositions} value={d.openPositions} />
        <Stat
          label="Days live"
          Icon={IconCalendar}
          value={daysLive(d.firstDecisionAt)}
        />
        <Stat label="Cycles run" Icon={IconCycles} value={d.cyclesRun} />
        <Stat
          label="Trades filled"
          Icon={IconTrades}
          value={d.tradesSubmitted}
        />
        <Stat
          label="Refused by risk checks"
          Icon={IconRefused}
          value={d.refused}
          tone="acc"
        />
        <Stat
          label="Agent state"
          Icon={IconPulse}
          value={
            <span className="font-mono text-[12px]">
              {(d.agentStatus?.state ?? "unknown").replace(/_/g, " ")}
            </span>
          }
        />
      </div>

      {d.account && (
        <Panel
          title="Alpaca paper account"
          right={
            <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.08em] text-dim">
              <span className="rounded border border-acc/40 px-1.5 py-0.5 uppercase text-acc">
                Paper
              </span>
              {d.account.createdAt && (
                <span className="hidden sm:inline">
                  active since{" "}
                  {new Date(d.account.createdAt).toLocaleDateString()}
                </span>
              )}
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
            <AcctField
              label="Account"
              value={d.account.accountNumber ?? "—"}
            />
            <AcctField
              label="Status"
              value={(d.account.status ?? "unknown").toLowerCase()}
              tone={
                d.account.status === "ACTIVE" &&
                !d.account.tradingBlocked &&
                !d.account.accountBlocked
                  ? "up"
                  : "down"
              }
            />
            <AcctField
              label="Options level"
              value={
                d.account.optionsTradingLevel != null
                  ? `L${d.account.optionsTradingLevel}${
                      d.account.optionsTradingLevel >= 3 ? " · spreads" : ""
                    }`
                  : "—"
              }
              tone={
                (d.account.optionsTradingLevel ?? 0) >= 3 ? "txt" : "down"
              }
            />
            <AcctField
              label="Currency"
              value={d.account.currency ?? "—"}
              tone="sec"
            />
            <AcctField
              label="Cash"
              value={formatUsd(d.account.cash, 0)}
            />
            <AcctField
              label="Portfolio value"
              value={formatUsd(d.account.portfolioValue, 0)}
            />
            <AcctField
              label="Long market value"
              value={formatUsd(d.account.longMarketValue, 0)}
            />
            <AcctField
              label="Maintenance margin"
              value={formatUsd(d.account.maintenanceMargin, 0)}
            />
            <AcctField
              label="Buying power"
              value={formatUsd(d.account.buyingPower, 0)}
            />
            <AcctField
              label="Options buying power"
              value={formatUsd(d.account.optionsBuyingPower, 0)}
            />
            <AcctField
              label="Day trades (5d)"
              value={
                d.account.daytradeCount != null
                  ? `${d.account.daytradeCount}${
                      d.account.patternDayTrader ? " · PDT" : ""
                    }`
                  : "—"
              }
              tone={d.account.patternDayTrader ? "down" : "txt"}
            />
            <AcctField
              label="Prev close equity"
              value={formatUsd(d.account.lastEquity, 0)}
              tone="sec"
            />
          </div>
        </Panel>
      )}

      <Panel title="Equity curve">
        {d.equity && d.equity.points.length >= 2 ? (
          <EquityCurve
            initial={d.equity}
            variant="panel"
            markers={d.tradeMarkers}
            marketOpen={d.marketOpen}
          />
        ) : (
          <div className="flex h-[260px] items-center justify-center text-[12px] text-dim">
            No equity history from Alpaca yet.
          </div>
        )}
      </Panel>

      <Panel
        title="Latest decision"
        right={
          latest ? (
            <ActionBadge action={latest.action} outcome={latest.orderOutcome} />
          ) : undefined
        }
      >
        {latest ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10.5px] text-dim">
              <span className="inline-flex items-center gap-1.5">
                <TickerBadge symbol={latest.symbol} size={14} />
                {latest.symbol}
              </span>
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
                  <ActionBadge action={row.action} outcome={row.orderOutcome} />
                </span>
                <TickerBadge
                  symbol={row.symbol}
                  size={14}
                  className="mt-0.5 shrink-0"
                />
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
