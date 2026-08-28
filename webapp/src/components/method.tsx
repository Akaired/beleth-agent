import {
  IconBroadcast,
  IconEye,
  IconProhibit,
  IconScales,
} from "@/components/icons";

const STEPS = [
  {
    n: "01",
    tag: "LOOK",
    Icon: IconEye,
    title: "Look at every date",
    body: "Each cycle it prices SPY options across five expiry dates instead of favouring one, so nothing is chosen out of habit.",
  },
  {
    n: "02",
    tag: "COMPARE",
    Icon: IconScales,
    title: "Compare price to reality",
    body: "For each date it asks one question: are these options priced above what the market has actually been moving?",
  },
  {
    n: "03",
    tag: "REFUSE",
    Icon: IconProhibit,
    title: "Refuse unless it is clear",
    body: "It sells only where the answer is clearly yes, with the worst case capped in advance. Thin premium, a news event in the way, or a spent risk budget all stop it.",
  },
  {
    n: "04",
    tag: "PUBLISH",
    Icon: IconBroadcast,
    title: "Show the decision either way",
    body: "What it read, what it chose, and which rule stopped it are all recorded — a refusal is written up as fully as a trade.",
  },
];

export function Method() {
  return (
    <section
      id="method"
      className="px-4 md:px-[clamp(16px,3vw,40px)] py-[clamp(40px,6vw,72px)]"
    >
      <h2 className="text-xl font-semibold tracking-[-0.01em]">How it decides</h2>
      <p className="mt-2 text-[13.5px] leading-[1.6] text-sec max-w-[72ch]">
        The same four steps, over and over, while the market is open. Any one of them can
        stop the trade.
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-7 mt-8">
        {STEPS.map((s) => (
          <div
            key={s.n}
            className="border-t-2 border-neutralbar hover:border-up transition-colors pt-3"
          >
            <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.06em] text-dim">
              <s.Icon size={13} className="text-sec" />
              {s.n} · {s.tag}
            </div>
            <div className="mt-2 text-[13.5px] font-semibold">{s.title}</div>
            <p className="mt-1.5 text-[12.5px] leading-[1.6] text-sec">{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}