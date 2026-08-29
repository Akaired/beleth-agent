import { CountUp } from "@/components/count-up";
import { EquityCurve } from "@/components/equity-curve";
import { IconChart } from "@/components/icons";
import type { EquityHistory, TradeMarker } from "@/lib/equity";

export type TearsheetStat = {
  label: string;
  value: number;
  tone: "txt" | "acc";
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
      <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label}>
            <div
              className={`font-mono text-[26px] leading-none tracking-[-0.02em] md:text-[34px] ${TONE[s.tone]}`}
            >
              <CountUp value={s.value} />
            </div>
            <div className="mt-2.5 text-xs text-sec">{s.label}</div>
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
