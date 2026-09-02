import Link from "next/link";
import type { Metadata } from "next";
import { requireSession, roleAtLeast } from "@/lib/auth";
import { fetchPortfolioView } from "@/lib/dashboard-queries";
import type { InstrumentQuote, PortfolioInstrument } from "@/lib/portfolio";
import {
  ForbiddenPanel,
  Metric,
  timeAgo,
} from "@/components/dashboard/ui";
import { TickerBadge } from "@/components/ticker-badge";
import { TvWidget } from "@/components/tv-widget";
import { formatSignedUsd, formatUsd } from "@/lib/format";
import {
  IconArrowRight,
  IconPortfolio,
  IconPulse,
  IconWarning,
} from "@/components/icons";

export const metadata: Metadata = { title: "Portfolio · Beleth backoffice" };

const CHART_WIDGET = "mini-symbol-overview";

function signedPct(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "n/a";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${Math.abs(n).toFixed(2)}%`;
}

function pnlTone(n: number | null): string {
  if (n == null) return "text-txt";
  return n > 0 ? "text-up" : n < 0 ? "text-down" : "text-sec";
}

// --- shared bits ------------------------------------------------------

function StatusPill({ status }: { status: PortfolioInstrument["status"] }) {
  if (status === "live") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-up/12 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-up">
        <IconPulse size={9} weight="bold" />
        live
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-dim">
      on watch
    </span>
  );
}

function Quote({ quote }: { quote: InstrumentQuote | null }) {
  if (!quote || quote.price == null) {
    return (
      <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-dim">
        no quote
      </span>
    );
  }
  const up = (quote.changeAbs ?? 0) >= 0;
  return (
    <div className="text-right leading-tight">
      <div className="font-mono text-[15px] text-txt">
        {formatUsd(quote.price)}
      </div>
      <div className={`font-mono text-[10px] ${up ? "text-up" : "text-down"}`}>
        {formatSignedUsd(quote.changeAbs)}
        {quote.changePct != null && (
          <span className="text-dim"> ({signedPct(quote.changePct)})</span>
        )}
      </div>
    </div>
  );
}

// --- cards -----------------------------------------------------------

function LiveCard({ i }: { i: PortfolioInstrument }) {
  const s = i.stats;
  return (
    <article className="overflow-hidden rounded-md border border-line bg-panel">
      <header className="flex items-start justify-between gap-3 border-b border-line bg-panel-head px-4 py-3">
        <div className="flex items-start gap-3">
          <TickerBadge symbol={i.symbol} size={36} className="mt-0.5" />
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-[15px] text-txt">{i.symbol}</span>
              <StatusPill status={i.status} />
            </div>
            <span className="font-mono text-[10px] text-dim">
              {i.name} · {i.exchange}
            </span>
          </div>
        </div>
        <Quote quote={i.quote} />
      </header>

      <div className="flex flex-col gap-3.5 p-4">
        <TvWidget widgetId={CHART_WIDGET} symbol={i.tvSymbol} />
        <p className="text-[12px] leading-relaxed text-sec">{i.note}</p>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-rowline pt-3 sm:grid-cols-4">
          <Metric
            label="Open"
            value={String(s.openSpreads)}
            sub={
              s.openSpreads > 0
                ? `${formatSignedUsd(s.unrealizedPnl)} unreal.`
                : undefined
            }
            tone={s.openSpreads > 0 ? pnlTone(s.unrealizedPnl) : "text-txt"}
          />
          <Metric
            label="Closed"
            value={String(s.closed)}
            sub={
              s.closed > 0 ? `${formatSignedUsd(s.realizedPnl)} real.` : undefined
            }
            tone={s.closed > 0 ? pnlTone(s.realizedPnl) : "text-txt"}
          />
          <Metric
            label="Win rate"
            value={s.closed > 0 ? `${s.wins}/${s.closed}` : "n/a"}
          />
          <Metric
            label="Cycles"
            value={String(s.cycles)}
            sub={s.lastSeen ? `last ${timeAgo(s.lastSeen)}` : undefined}
          />
        </div>
      </div>
    </article>
  );
}

function WatchCard({ i }: { i: PortfolioInstrument }) {
  return (
    <article className="overflow-hidden rounded-md border border-line bg-panel opacity-60 grayscale transition-opacity hover:opacity-90">
      <header className="flex items-start justify-between gap-3 border-b border-line bg-panel-head px-4 py-3">
        <div className="flex items-start gap-3">
          <TickerBadge symbol={i.symbol} size={30} className="mt-0.5" />
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="text-[14px] text-txt">{i.symbol}</span>
              <StatusPill status={i.status} />
            </div>
            <span className="font-mono text-[10px] text-dim">
              {i.name} · {i.exchange}
            </span>
          </div>
        </div>
        <Quote quote={i.quote} />
      </header>

      <div className="flex flex-col gap-3 p-4">
        <TvWidget widgetId={CHART_WIDGET} symbol={i.tvSymbol} />
        <p className="text-[12px] leading-relaxed text-sec">{i.note}</p>
        <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
          Not traded yet
        </span>
      </div>
    </article>
  );
}

// --- page ----------------------------------------------------------

function ParamItem({ label, value }: { label: string; value: string | null }) {
  return (
    <span className="font-mono text-[10.5px]">
      <span className="text-dim uppercase tracking-[0.1em]">{label} </span>
      <span className="text-sec">{value ?? "n/a"}</span>
    </span>
  );
}

export default async function PortfolioPage() {
  const ctx = await requireSession();
  if (!roleAtLeast(ctx.role, "demo_admin")) return <ForbiddenPanel />;

  const { live, watch, params, alpacaOk } = await fetchPortfolioView();

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h1 className="flex items-center gap-2 text-[18px] font-light">
          <IconPortfolio size={17} weight="bold" className="text-acc" />
          Portfolio
        </h1>
        <span className="font-mono text-[10.5px] text-dim">
          {live.length} live · {watch.length} on watch
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-line bg-panel px-4 py-3">
        <ParamItem label="Short delta" value={params.deltaBand} />
        <ParamItem label="Strike width" value={params.strikeWidth} />
        <ParamItem label="DTE ladder" value={params.dteLadder} />
        <Link
          href="/dashboard/strategy"
          className="ml-auto flex items-center gap-1 font-mono text-[10.5px] text-acc hover:underline"
        >
          Strategy
          <IconArrowRight size={11} weight="bold" />
        </Link>
      </div>

      {!alpacaOk && (
        <div className="flex items-start gap-2 rounded-md border border-killline/60 bg-panel px-4 py-3 text-[12px] text-sec">
          <IconWarning size={15} className="mt-0.5 shrink-0 text-down" />
          <p>
            Live quotes and position P&amp;L from Alpaca are unavailable right
            now. The universe and Beleth&apos;s decision history are still shown.
          </p>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-sec">
            Traded now
          </h2>
          <span className="font-mono text-[10px] text-dim">
            {live.length} underlying{live.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {live.map((i) => (
            <LiveCard key={i.symbol} i={i} />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-sec">
            On watch
          </h2>
          <span className="font-mono text-[10px] text-dim">
            {watch.length} candidate{watch.length === 1 ? "" : "s"}
          </span>
        </div>
        {watch.length === 0 ? (
          <div className="rounded-md border border-line bg-panel px-3 py-6 text-center text-[12px] text-dim">
            No candidates queued.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {watch.map((i) => (
              <WatchCard key={i.symbol} i={i} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
