import type { CSSProperties } from "react";
import { BelethSprite } from "@/components/beleth-sprite";
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
}: {
  latestDecision: DecisionRow | null;
  bubbles: ThoughtBubble[];
}) {
  return (
    <section className="grid md:grid-cols-2 items-center gap-6 md:gap-[clamp(24px,4vw,56px)] px-4 md:px-[clamp(16px,3vw,40px)] py-[clamp(40px,6vw,80px)]">
      <div>
        <h1
          className="font-serif font-light text-[clamp(34px,4.4vw,60px)] leading-[1.06] tracking-[-0.02em] max-w-[21ch]"
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
            className="inline-block bg-txt text-bg text-[13px] font-medium px-[18px] py-[10px] rounded-[2px] hover:bg-acc transition-colors whitespace-nowrap"
          >
            See today&apos;s decision
          </a>
          <a
            href="#method"
            className="text-[13px] text-sec hover:text-acc transition-colors whitespace-nowrap"
          >
            How it decides →
          </a>
        </div>
        {latestDecision && (
          <div className="mt-10 border-l-2 border-line pl-3">
            <div className="flex items-baseline gap-3 font-mono text-[10px] tracking-[0.08em]">
              <span className="text-faint">LATEST CYCLE</span>
              <span
                className={
                  latestDecision.action === "trade" ? "text-up" : "text-dim"
                }
              >
                {latestDecision.action.replace("_", " ").toUpperCase()}
              </span>
              <span className="text-faint">
                {latestDecision.symbol} · {utcStamp(latestDecision.created_at)}
              </span>
            </div>
            <p className="mt-1.5 text-[13px] leading-[1.55] text-sec max-w-[60ch]">
              {latestDecision.summary}
            </p>
          </div>
        )}
      </div>
      <div className="flex items-center justify-center">
        <div className="relative w-full max-w-[300px]">
          <BelethSprite />
          <ThoughtBubbles bubbles={bubbles} />
        </div>
      </div>
    </section>
  );
}