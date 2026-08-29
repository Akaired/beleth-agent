import type { ComponentType } from "react";
import { CountUp } from "@/components/count-up";
import { EquityCurve } from "@/components/equity-curve";
import { IconChart } from "@/components/icons";
import type { EquityHistory, TradeMarker } from "@/lib/equity";

type IconComponent = ComponentType<{ size?: number; className?: string }>;

export type TearsheetStat = {
  label: string;
  value: number;
  tone: "txt" | "acc";
  Icon: IconComponent;
};

const TONE: Record<TearsheetStat["tone"], string> = {
  txt: "text-txt",
  acc: "text-acc",
};

export function Tearsheet({
  stats,
  equity,
  tradeMarkers = [],
  marketOpen,
}: {
  stats: TearsheetStat[];
  equity: EquityHistory | null;
  tradeMarkers?: TradeMarker[];
  marketOpen?: boolean | null;
}) {
  const hasCurve = !!equity && equity.points.length >= 2;

  return (
    <section
      id="live"
      className="border-y border-line px-4 pt-8 pb-12 md:px-[clamp(16px,3vw,40px)]"
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div
            key={s.label}
            className="flex items-center gap-4 rounded-lg border border-line bg-panel px-5 py-6"
          >
            <s.Icon size={30} className="shrink-0 text-dim" />
            <div className="min-w-0 flex-1 text-center">
              <div
                className={`font-mono text-[30px] leading-none tracking-[-0.02em] md:text-[38px] ${TONE[s.tone]}`}
              >
                <CountUp value={s.value} />
              </div>
              <div className="mt-2 text-xs text-sec">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 rounded-xl border border-line bg-panel p-4 md:p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-sec">
            <IconChart size={13} className="text-dim" />
            Equity curve
          </span>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
            {hasCurve ? "alpaca paper · live" : "live series soon"}
          </span>
        </div>
        {hasCurve ? (
          <EquityCurve
            initial={equity}
            variant="hero"
            markers={tradeMarkers}
            marketOpen={marketOpen}
          />
        ) : (
          <div className="flex h-[360px] items-center justify-center text-[12px] text-dim">
            The equity curve appears once the account has a little history.
          </div>
        )}
      </div>
    </section>
  );
}
