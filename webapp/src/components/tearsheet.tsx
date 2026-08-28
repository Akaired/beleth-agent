import { CountUp } from "@/components/count-up";

export type TearsheetStat = {
  label: string;
  value: number;
  tone: "txt" | "acc";
};

const TONE: Record<TearsheetStat["tone"], string> = {
  txt: "text-txt",
  acc: "text-acc",
};

export function Tearsheet({ stats }: { stats: TearsheetStat[] }) {
  return (
    <section
      id="live"
      className="grid grid-cols-2 md:grid-cols-4 gap-8 px-4 md:px-[clamp(16px,3vw,40px)] py-7 border-y border-line"
    >
      {stats.map((s) => (
        <div key={s.label}>
          <div className={`font-mono text-[26px] md:text-[34px] leading-none tracking-[-0.02em] font-normal ${TONE[s.tone]}`}>
            <CountUp value={s.value} />
          </div>
          <div className="mt-2.5 text-xs text-sec">{s.label}</div>
        </div>
      ))}
    </section>
  );
}