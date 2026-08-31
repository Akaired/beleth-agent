import type { CSSProperties } from "react";
import { BelethSprite } from "@/components/beleth-sprite";
import { IconArrowDown, IconChart } from "@/components/icons";
import { TickerBadge } from "@/components/ticker-badge";
import type { BelethPnl, BelethScene } from "@/lib/beleth";
import type { DecisionRow, ThoughtBubble } from "@/lib/queries";

const BUBBLE_TONE: Record<ThoughtBubble["tone"], string> = {
  txt: "text-txt",
  acc: "text-acc",
  up: "text-up",
  down: "text-down",
};

function bubblePosition(p: ThoughtBubble["position"]): CSSProperties {
  return p.side === "left"
    ? { top: p.top, left: p.offset }
    : { top: p.top, right: p.offset };
}

function ThoughtBubbles({ bubbles }: { bubbles: ThoughtBubble[] }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {bubbles.map((b) => (
        <div
          key={`${b.label}-${b.position.top}-${b.position.side}`}
          className="thought-bubble absolute flex items-baseline gap-1.5 bg-panel border border-inputline rounded-[2px] px-[7px] py-[3px] whitespace-nowrap font-mono text-[10px]"
          style={{ top: b.position.top, ...bubblePosition(b.position), animationDelay: b.delay }}
        >
          <span className="text-sec">{b.label}</span>
          <span className={BUBBLE_TONE[b.tone]}>{b.value}</span>
        </div>
      ))}
    </div>
  );
}

function utcStamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export function Hero({
  latestDecision,
  bubbles,
  scene,
  sceneCaption,
  pnl = null,
}: {
  latestDecision: DecisionRow | null;
  bubbles: ThoughtBubble[];
  scene: BelethScene;
  sceneCaption: string;
  pnl?: BelethPnl;
}) {
  return (
    <section className="grid md:grid-cols-2 items-center gap-6 md:gap-[clamp(24px,4vw,56px)] px-4 md:px-[clamp(16px,3vw,40px)] py-[clamp(40px,6vw,80px)]">
      <div>
        <h1
          className="font-sans font-light text-[clamp(34px,4.4vw,60px)] leading-[1.06] tracking-[-0.02em] max-w-[21ch]"
        >
          It measures the edge before it takes the trade.
        </h1>
        <p className="mt-6 text-[15px] leading-[1.6] text-sec max-w-[50ch]">
          Selling an option is selling insurance on the market. Beleth checks whether the
          premium on offer is genuinely bigger than the risk it would be taking on — and when
          it isn&apos;t, it buys nothing and says why. Every refusal is published next to
          every trade.
        </p>
        <div className="flex items-center gap-6 mt-8">
          <a
            href="#live"
            className="inline-flex items-center gap-1.5 bg-txt text-bg text-[13px] font-medium px-[18px] py-[10px] rounded-[2px] hover:bg-acc transition-colors whitespace-nowrap"
          >
            <IconChart size={14} weight="bold" />
            See current equity curve
          </a>
          <a
            href="#method"
            className="inline-flex items-center gap-1 text-[13px] text-sec hover:text-acc transition-colors whitespace-nowrap"
          >
            How it decides
            <IconArrowDown size={13} />
          </a>
        </div>
        {latestDecision && (
          <div className="mt-10 max-w-[60ch] rounded-xl bg-white px-5 py-4 text-[#0b0e11]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] tracking-[0.08em] text-[#3a3f45]">
              <span className="flex items-center gap-1.5">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    latestDecision.action === "trade" &&
                    latestDecision.orderOutcome !== "not_sent" &&
                    latestDecision.orderOutcome !== "submit_failed"
                      ? "bg-[#1e9e6a]"
                      : "bg-[#9aa0a6]"
                  }`}
                />
                LATEST CYCLE
              </span>
              <span className="font-medium text-[#0b0e11]">
                {latestDecision.action === "trade" &&
                latestDecision.orderOutcome === "not_sent"
                  ? "TRADE · NOT SENT"
                  : latestDecision.action === "trade" &&
                      latestDecision.orderOutcome === "submit_failed"
                    ? "TRADE · FAILED"
                    : latestDecision.action.replace("_", " ").toUpperCase()}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <TickerBadge symbol={latestDecision.symbol} size={14} />
                {latestDecision.symbol} · {utcStamp(latestDecision.created_at)}
              </span>
            </div>
            <p className="mt-2 text-[13px] leading-[1.55] text-[#2b2f34]">
              {latestDecision.summary}
            </p>
          </div>
        )}
      </div>
      <div className="flex flex-col items-center justify-center">
        <div className="relative w-full max-w-[300px]">
          <BelethSprite scene={scene} pnl={pnl} />
          <ThoughtBubbles bubbles={bubbles} />
        </div>
        <p className="mt-10 font-mono text-[10px] tracking-[0.14em] text-dim uppercase">
          {sceneCaption}
        </p>
      </div>
    </section>
  );
}