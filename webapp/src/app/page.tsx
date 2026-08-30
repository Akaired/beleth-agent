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
import {
  BELETH_SCENE_META,
  belethPnl,
  belethScene,
} from "@/lib/beleth";
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
  let markersLive = false;
  try {
    [equity, tradeMarkers, clock] = await Promise.all([
      fetchEquityHistory(DEFAULT_EQUITY_RANGE),
      fetchTradeMarkers()
        .then((m) => {
          markersLive = true;
          return m;
        })
        .catch(() => [] as TradeMarker[]),
      fetchMarketClock().catch(() => null),
    ]);
  } catch (err) {
    console.error("equity / trade-marker fetch failed", err);
  }

  // "Trades filled" = entries that actually executed on the paper account
  // (an entry marker exists only for a filled order). Canceled, expired and
  // broker-rejected orders never become markers; the "exit" markers are the
  // closing leg of a round trip, not a separate trade. Falls back to the
  // Supabase submitted-order count only when Alpaca is unreachable.
  const tradesFilled = markersLive
    ? tradeMarkers.filter((m) => m.state === "open" || m.state === "closed").length
    : data.tradesSubmitted;

  const belethSceneId = belethScene({
    status: data.agentStatus,
    decision: data.latestDecision,
    clock,
  });
  const belethTint = belethPnl(data.latestDecision);

  const stats: TearsheetStat[] = [
    {
      label: "Days live",
      value: daysLive(data.firstDecisionAt),
      tone: "txt",
      Icon: IconCalendar,
    },
    { label: "Cycles run", value: data.cyclesRun, tone: "txt", Icon: IconCycles },
    {
      label: "Trades filled",
      value: tradesFilled,
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
        <Hero
          latestDecision={data.latestDecision}
          bubbles={thoughtBubbles(data.latestDecision)}
          scene={belethSceneId}
          sceneCaption={BELETH_SCENE_META[belethSceneId].caption}
          pnl={belethTint}
        />
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
