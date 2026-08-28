import { CountUp } from "@/components/count-up";
import { IconChart } from "@/components/icons";

export type TearsheetStat = {
  label: string;
  value: number;
  tone: "txt" | "acc";
};

const TONE: Record<TearsheetStat["tone"], string> = {
  txt: "text-txt",
  acc: "text-acc",
};

// Fake equity-curve placeholder — a fixed, hand-drawn path. Swapped for the
// real series once the homepage reads it. Deterministic so SSR and client match.
const CURVE = [
  4, 9, 7, 14, 12, 20, 24, 19, 28, 33, 30, 39, 44, 41, 50, 56, 53, 62, 68, 74,
];

function FakeChart() {
  const w = 1000;
  const h = 220;
  const max = Math.max(...CURVE);
  const step = w / (CURVE.length - 1);
  const pts = CURVE.map((v, i) => {
    const x = i * step;
    const y = h - 16 - (v / max) * (h - 40);
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="h-[180px] w-full"
      role="img"
      aria-label="Placeholder equity curve"
    >
      <defs>
        <linearGradient id="tearsheet-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-up)" stopOpacity="0.20" />
          <stop offset="100%" stopColor="var(--color-up)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line
          key={f}
          x1="0"
          x2={w}
          y1={h * f}
          y2={h * f}
          stroke="var(--color-rowline)"
          strokeWidth="1"
        />
      ))}
      <path d={area} fill="url(#tearsheet-fill)" />
      <path
        d={line}
        fill="none"
        stroke="var(--color-up)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function Tearsheet({ stats }: { stats: TearsheetStat[] }) {
  return (
    <section
      id="live"
      className="border-y border-line px-4 py-7 md:px-[clamp(16px,3vw,40px)]"
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

      <div className="mt-7 rounded-xl border border-line bg-panel p-4 md:p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-sec">
            <IconChart size={13} className="text-dim" />
            Equity curve
          </span>
          <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
            placeholder — live series soon
          </span>
        </div>
        <FakeChart />
      </div>
    </section>
  );
}
