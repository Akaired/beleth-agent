import { CtaSection } from "@/components/cta-section";
import { Hero } from "@/components/hero";
import { Method } from "@/components/method";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Tearsheet, type TearsheetStat } from "@/components/tearsheet";
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

  const stats: TearsheetStat[] = [
    { label: "Days live", value: daysLive(data.firstDecisionAt), tone: "txt" },
    { label: "Cycles run", value: data.cyclesRun, tone: "txt" },
    { label: "Trades submitted", value: data.tradesSubmitted, tone: "txt" },
    { label: "Refused by risk checks", value: data.refused, tone: "acc" },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-screen">
      <SiteHeader agentStatus={data.agentStatus} />
      {!live && (
        <div className="px-4 md:px-[clamp(16px,3vw,40px)] py-2 border-b border-line font-mono text-[10.5px] text-dim">
          LIVE DATA UNAVAILABLE — SHOWING PLACEHOLDER COUNTERS
        </div>
      )}
      <main>
        <Hero latestDecision={data.latestDecision} bubbles={thoughtBubbles(data.latestDecision)} />
        <Tearsheet stats={stats} />
        <Method />
        <CtaSection />
      </main>
      <SiteFooter />
    </div>
  );
}