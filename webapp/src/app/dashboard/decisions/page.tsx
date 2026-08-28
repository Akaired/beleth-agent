import Link from "next/link";
import type { Metadata } from "next";
import { requireSession, roleAtLeast } from "@/lib/auth";
import { fetchDecisionHistory } from "@/lib/dashboard-queries";
import {
  ActionBadge,
  ForbiddenPanel,
  formatUsd,
} from "@/components/dashboard/ui";
import {
  IconCaretLeft,
  IconCaretRight,
  IconDecisions,
} from "@/components/icons";

export const metadata: Metadata = { title: "Decisions — Beleth backoffice" };

const FILTERS = [
  { key: undefined, label: "All" },
  { key: "trade", label: "Trades" },
  { key: "no_trade", label: "No-trade" },
] as const;

export default async function DecisionsPage({
  searchParams,
}: PageProps<"/dashboard/decisions">) {
  const ctx = await requireSession();
  if (!roleAtLeast(ctx.role, "demo_admin")) return <ForbiddenPanel />;

  const sp = await searchParams;
  const page = Math.max(1, Number(sp?.page) || 1);
  const rawAction = Array.isArray(sp?.action) ? sp.action[0] : sp?.action;
  const action =
    rawAction === "trade" || rawAction === "no_trade" ? rawAction : undefined;

  const { rows, total, pageSize } = await fetchDecisionHistory({
    page,
    action,
  });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const qs = (p: number) =>
    `?page=${p}${action ? `&action=${action}` : ""}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="flex items-center gap-2 text-[18px] font-light">
          <IconDecisions size={17} weight="bold" className="text-acc" />
          Decision history
        </h1>
        <span className="font-mono text-[10.5px] text-dim">
          {total} rows · page {page}/{pages}
        </span>
      </div>

      <div className="flex gap-1 font-mono text-[10.5px] tracking-[0.06em]">
        {FILTERS.map((f) => {
          const on = f.key === action;
          return (
            <Link
              key={f.label}
              href={`/dashboard/decisions${f.key ? `?action=${f.key}` : ""}`}
              className={`px-2.5 py-1 rounded uppercase transition-colors ${
                on ? "bg-chipbg text-txt" : "text-dim hover:text-sec"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <div className="border border-line rounded-md bg-panel overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-table-head text-sec">
            <tr className="text-left font-mono text-[10px] tracking-[0.08em] uppercase">
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Sym</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium">Src</th>
              <th className="px-3 py-2 font-medium text-right">Equity</th>
              <th className="px-3 py-2 font-medium text-right">Day P&L</th>
              <th className="px-3 py-2 font-medium">Summary</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pnl = Number(r.day_pnl);
              return (
                <tr
                  key={r.id}
                  className="border-t border-rowline hover:bg-hoverbg"
                >
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-[10.5px] text-dim">
                    <Link
                      href={`/dashboard/decisions/${r.id}`}
                      className="hover:text-acc"
                    >
                      {new Date(r.created_at).toLocaleString()}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-[10.5px]">
                    {r.symbol}
                  </td>
                  <td className="px-3 py-2">
                    <ActionBadge action={r.action} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[10.5px] text-sec">
                    {r.decision_source}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[10.5px]">
                    {formatUsd(Number(r.equity), 0)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono text-[10.5px] ${
                      pnl > 0 ? "text-up" : pnl < 0 ? "text-down" : "text-sec"
                    }`}
                  >
                    {formatUsd(pnl, 0)}
                  </td>
                  <td className="px-3 py-2 text-sec max-w-[420px]">
                    <span className="line-clamp-1">{r.summary}</span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-dim">
                  No decisions match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between font-mono text-[11px]">
        {page > 1 ? (
          <Link
            href={`/dashboard/decisions${qs(page - 1)}`}
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
            href={`/dashboard/decisions${qs(page + 1)}`}
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
