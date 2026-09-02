import Link from "next/link";
import type { Metadata } from "next";
import { requireSession, roleAtLeast } from "@/lib/auth";
import { fetchPositionsView } from "@/lib/dashboard-queries";
import type { SpreadPosition } from "@/lib/positions";
import { isPositionState } from "@/lib/positions";
import {
  ForbiddenPanel,
  PositionStateBadge,
  SideTag,
  formatUsd,
} from "@/components/dashboard/ui";
import { TickerBadge } from "@/components/ticker-badge";
import { POSITIONS_PAGE_SIZE } from "@/lib/pagination";
import { formatDateTime } from "@/lib/format";
import {
  IconArrowDown,
  IconArrowRight,
  IconArrowUp,
  IconCaretLeft,
  IconCaretRight,
  IconPositions,
  IconWarning,
} from "@/components/icons";

export const metadata: Metadata = { title: "Positions — Beleth backoffice" };


const FILTERS = [
  { key: undefined, label: "All" },
  { key: "closed", label: "Closed" },
  { key: "canceled", label: "Canceled" },
  { key: "failed", label: "Failed" },
] as const;

// --- formatting helpers ---------------------------------------------------

function signedUsd(n: number | null, digits: 0 | 2 = 0): string {
  if (n === null || Number.isNaN(n)) return "—";
  const s = formatUsd(Math.abs(n), digits);
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}

function pnlTone(n: number | null): string {
  if (n === null) return "text-dim";
  return n > 0 ? "text-up" : n < 0 ? "text-down" : "text-sec";
}

function structureName(p: SpreadPosition): string {
  const m = p.spread ? /^([a-z ]+?)\s*[-\d]/.exec(p.spread) : null;
  if (m) {
    const base = m[1].trim();
    return base.charAt(0).toUpperCase() + base.slice(1) + " spread";
  }
  if (p.right) return `${p.right === "C" ? "Call" : "Put"} spread`;
  return "Vertical spread";
}

function fmtExpiry(e: string | null): string | null {
  if (!e || e.length !== 6) return null;
  const d = new Date(
    Date.UTC(
      2000 + Number(e.slice(0, 2)),
      Number(e.slice(2, 4)) - 1,
      Number(e.slice(4, 6)),
    ),
  );
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("en-US", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

function totalCredit(p: SpreadPosition): number | null {
  return p.entryCredit != null && p.qty != null
    ? p.entryCredit * 100 * p.qty
    : null;
}

// --- shared bits --------------------------------------------------------

/** The two legs with explicit BUY / SELL, so the operation reads at a glance. */
function SpreadLegs({
  p,
  compact = false,
}: {
  p: SpreadPosition;
  compact?: boolean;
}) {
  if (p.shortStrike == null && p.longStrike == null) return null;
  const r = p.right ?? "";

  if (compact) {
    return (
      <span className="inline-flex items-center gap-1 font-mono text-[10px] text-dim">
        <IconArrowDown size={9} weight="bold" className="text-down" />
        <span className="text-down">sell</span> {p.shortStrike ?? "?"}
        <span className="mx-0.5 text-faint">·</span>
        <IconArrowUp size={9} weight="bold" className="text-up" />
        <span className="text-up">buy</span> {p.longStrike ?? "?"} {r}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <SideTag side="sell" />
        <span className="font-mono text-[12.5px] text-txt">
          {p.shortStrike ?? "?"} {r}
        </span>
        <span className="text-[10px] text-dim">short leg</span>
      </div>
      <div className="flex items-center gap-2">
        <SideTag side="buy" />
        <span className="font-mono text-[12.5px] text-txt">
          {p.longStrike ?? "?"} {r}
        </span>
        <span className="text-[10px] text-dim">long leg · protection</span>
      </div>
    </div>
  );
}

function DecisionLink({ id }: { id: string | null }) {
  return (
    <span className="inline-flex w-[60px] justify-end font-mono text-[10px]">
      {id ? (
        <Link
          href={`/dashboard/decisions/${id}`}
          className="inline-flex items-center gap-1 text-acc hover:underline"
        >
          view <IconArrowRight size={11} weight="bold" />
        </Link>
      ) : (
        <span className="text-dim">—</span>
      )}
    </span>
  );
}

function Metric({
  label,
  value,
  tone = "text-txt",
  sub,
}: {
  label: string;
  value: string;
  tone?: string;
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
        {label}
      </span>
      <span className={`font-mono text-[13px] ${tone}`}>{value}</span>
      {sub && <span className="font-mono text-[9.5px] text-dim">{sub}</span>}
    </div>
  );
}

// --- open positions ---------------------------------------------------

function OpenCard({ p }: { p: SpreadPosition }) {
  const exp = fmtExpiry(p.expiry);
  const credit = totalCredit(p);
  return (
    <div className="rounded-md border border-line bg-inset/40 px-3 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex items-start gap-3">
          <TickerBadge symbol={p.underlying} size={34} className="mt-0.5" />
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[14px] text-txt">{structureName(p)}</span>
              <SideTag side="sell" size="md" />
            </div>
            <span className="font-mono text-[10.5px] text-dim">
              {p.underlying} · {p.qty ?? "?"} contract{p.qty === 1 ? "" : "s"}
              {exp ? ` · exp ${exp}` : ""}
            </span>
          </div>
        </div>
        <div className="text-right">
          <span
            className={`font-mono text-[18px] ${pnlTone(p.unrealizedPnl)}`}
          >
            {signedUsd(p.unrealizedPnl)}
          </span>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
            unrealized P&amp;L
          </div>
        </div>
      </div>

      <div className="mt-3 border-t border-rowline pt-3">
        <SpreadLegs p={p} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-rowline pt-3 sm:grid-cols-4">
        <Metric
          label="Credit taken"
          value={formatUsd(credit, 0)}
          sub={
            p.entryCredit != null ? `${formatUsd(p.entryCredit)} / share` : undefined
          }
        />
        <Metric label="Mkt value" value={formatUsd(p.marketValue, 0)} />
        <Metric
          label="Max loss"
          value={formatUsd(p.maxLoss, 0)}
          tone="text-sec"
        />
        <Metric label="Opened" value={formatDateTime(p.openedAt)} tone="text-sec" />
      </div>

      <div className="mt-3 flex justify-end border-t border-rowline pt-2.5">
        <DecisionLink id={p.decisionId} />
      </div>
    </div>
  );
}

// --- page --------------------------------------------------------------

export default async function PositionsPage({
  searchParams,
}: PageProps<"/dashboard/positions">) {
  const ctx = await requireSession();
  if (!roleAtLeast(ctx.role, "demo_admin")) return <ForbiddenPanel />;

  const sp = await searchParams;
  const rawState = Array.isArray(sp?.state) ? sp.state[0] : sp?.state;
  const stateFilter = isPositionState(rawState) ? rawState : undefined;
  const page = Math.max(1, Number(Array.isArray(sp?.page) ? sp.page[0] : sp?.page) || 1);

  const { open, history, alpacaOk } = await fetchPositionsView();
  const filtered = stateFilter
    ? history.filter((p) => p.state === stateFilter)
    : history;

  const pages = Math.max(1, Math.ceil(filtered.length / POSITIONS_PAGE_SIZE));
  const clamped = Math.min(page, pages);
  const rows = filtered.slice(
    (clamped - 1) * POSITIONS_PAGE_SIZE,
    clamped * POSITIONS_PAGE_SIZE,
  );
  const qs = (p: number) =>
    `?${stateFilter ? `state=${stateFilter}&` : ""}page=${p}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="flex items-center gap-2 text-[18px] font-light">
          <IconPositions size={17} weight="bold" className="text-acc" />
          Positions
        </h1>
        <span className="font-mono text-[10.5px] text-dim">
          {open.length} open · {history.length} in history
        </span>
      </div>

      {!alpacaOk && (
        <div className="flex items-start gap-2 rounded-md border border-killline/60 bg-panel px-4 py-3 text-[12px] text-sec">
          <IconWarning size={15} className="mt-0.5 shrink-0 text-down" />
          <p>
            Live position data from Alpaca is unavailable right now. Open
            positions and their P&amp;L cannot be shown; the history below is
            limited to orders the risk gate rejected before submission.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-sec">
            Open positions
          </h2>
          <span className="font-mono text-[10px] text-dim">
            {open.length} spread{open.length === 1 ? "" : "s"}
          </span>
        </div>
        {open.length === 0 ? (
          <div className="rounded-md border border-line bg-panel px-3 py-6 text-center text-[12px] text-dim">
            No open positions — the agent holds nothing on the paper account
            right now.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {open.map((p) => (
              <OpenCard key={p.id} p={p} />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-sec">
            History
          </h2>
          <div className="flex gap-1 font-mono text-[10.5px] tracking-[0.06em]">
            {FILTERS.map((f) => {
              const on = f.key === stateFilter;
              return (
                <Link
                  key={f.label}
                  href={`/dashboard/positions${f.key ? `?state=${f.key}` : ""}`}
                  className={`rounded px-2.5 py-1 uppercase transition-colors ${
                    on ? "bg-chipbg text-txt" : "text-dim hover:text-sec"
                  }`}
                >
                  {f.label}
                </Link>
              );
            })}
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border border-line bg-panel">
          <table className="w-full text-[12px]">
            <thead className="bg-table-head text-sec">
              <tr className="text-left font-mono text-[10px] uppercase tracking-[0.08em]">
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Structure</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="px-3 py-2 font-medium text-right">Qty</th>
                <th className="px-3 py-2 font-medium text-right">Realized P&amp;L</th>
                <th className="px-3 py-2 font-medium">Detail</th>
                <th className="px-3 py-2 font-medium text-right">Decision</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const detail =
                  p.state === "closed"
                    ? p.exitReason
                      ? `bought to close · ${p.exitReason}`
                      : "bought to close"
                    : (p.failureReason ?? p.alpacaStatus ?? "—");
                return (
                  <tr
                    key={p.id}
                    className="border-t border-rowline align-top hover:bg-hoverbg"
                  >
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[10px] text-dim">
                      {formatDateTime(p.closedAt ?? p.openedAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-start gap-2">
                        <TickerBadge
                          symbol={p.underlying}
                          size={16}
                          className="mt-0.5"
                        />
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[11.5px] text-txt">
                            {structureName(p)}
                          </span>
                          <SpreadLegs p={p} compact />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <PositionStateBadge state={p.state} />
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[10.5px]">
                      {p.qty ?? "—"}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right font-mono text-[10.5px] ${pnlTone(
                        p.realizedPnl,
                      )}`}
                    >
                      {signedUsd(p.realizedPnl)}
                    </td>
                    <td className="max-w-[260px] px-3 py-2.5 text-[11.5px] text-sec">
                      <span className="line-clamp-1">{detail}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <DecisionLink id={p.decisionId} />
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-dim">
                    No positions match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-between font-mono text-[11px]">
            {clamped > 1 ? (
              <Link
                href={`/dashboard/positions${qs(clamped - 1)}`}
                className="flex items-center gap-1 text-acc hover:underline"
              >
                <IconCaretLeft size={12} weight="bold" /> newer
              </Link>
            ) : (
              <span className="flex items-center gap-1 text-faint">
                <IconCaretLeft size={12} weight="bold" /> newer
              </span>
            )}
            <span className="text-dim">
              page {clamped}/{pages}
            </span>
            {clamped < pages ? (
              <Link
                href={`/dashboard/positions${qs(clamped + 1)}`}
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
        )}
      </div>
    </div>
  );
}
