import { CtaSection } from "@/components/cta-section";
import { Hero } from "@/components/hero";
import {
  IconCalendar,
  IconCycles,
  IconPositions,
  IconRefused,
  IconTrades,
} from "@/components/icons";
import { Method } from "@/components/method";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Tearsheet, type TearsheetStat } from "@/components/tearsheet";
import {
  fetchEquityHistory,
  fetchMarketClock,
  fetchTradeMarkers,
  DEFAULT_EQUITY_RANGE,
} from "@/lib/alpaca";
import type { EquityHistory, MarketClock, TradeMarker } from "@/lib/equity";
import {
  daysLive,
  fetchHomepageData,
  thoughtBubbles,
  type HomepageData,
} from "@/lib/queries";

// Fresh enough to feel live (the agent cycles every ~5 minutes), cheap enough
// to sit behind the CDN. See webapp/README.md, "Rendering model".
export const revalidate = 60;

function emptyData(): HomepageData {
  return {
    latestDecision: null,
    cyclesRun: 0,
    tradesSubmitted: 0,
    refused: 0,
    openPositions: 0,
    firstDecisionAt: null,
    agentStatus: null,
  };
}

export default async function Home() {
  let data = emptyData();
  let live = true;
  try {
    data = await fetchHomepageData();
  } catch (err) {
    // Fail soft and visibly: a missing anon key or a Supabase hiccup must not
    // blank the showcase — it renders with zeros and says so.
    console.error("homepage data fetch failed", err);
    live = false;
  }

  // The equity curve and trade markers come from Alpaca, a separate dependency —
  // its own failure just hides the chart, it never flips the page into
  // "data unavailable".
  let equity: EquityHistory | null = null;
  let tradeMarkers: TradeMarker[] = [];
  let clock: MarketClock | null = null;
  try {
    [equity, tradeMarkers, clock] = await Promise.all([
      fetchEquityHistory(DEFAULT_EQUITY_RANGE),
      fetchTradeMarkers().catch(() => [] as TradeMarker[]),
      fetchMarketClock().catch(() => null),
    ]);
  } catch (err) {
    console.error("equity / trade-marker fetch failed", err);
  }

  const stats: TearsheetStat[] = [
    {
      label: "Days live",
      value: daysLive(data.firstDecisionAt),
      tone: "txt",
      Icon: IconCalendar,
    },
    { label: "Cycles run", value: data.cyclesRun, tone: "txt", Icon: IconCycles },
    {
      label: "Trades submitted",
      value: data.tradesSubmitted,
      tone: "txt",
      Icon: IconTrades,
    },
    {
      label: "Open positions",
      value: data.openPositions,
      tone: "txt",
      Icon: IconPositions,
    },
    {
      label: "Refused by risk checks",
      value: data.refused,
      tone: "acc",
      Icon: IconRefused,
    },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <SiteHeader agentStatus={data.agentStatus} marketOpen={clock?.isOpen ?? null} />
      {!live && (
        <div className="border-b border-line font-mono text-[10.5px] text-dim">
          <div className="mx-auto w-full max-w-6xl px-4 md:px-[clamp(16px,3vw,40px)] py-2">
            LIVE DATA UNAVAILABLE — SHOWING PLACEHOLDER COUNTERS
          </div>
        </div>
      )}
      <main className="mx-auto w-full max-w-6xl">
        <Hero latestDecision={data.latestDecision} bubbles={thoughtBubbles(data.latestDecision)} />
        <Tearsheet
          stats={stats}
          equity={equity}
          tradeMarkers={tradeMarkers}
          marketOpen={clock?.isOpen ?? null}
        />
        <Method />
        <CtaSection />
      </main>
      <SiteFooter />
    </div>
  );
}
