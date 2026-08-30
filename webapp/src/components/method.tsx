"use client";

import { useEffect, useRef, useState } from "react";
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
  const gridRef = useRef<HTMLDivElement>(null);
  const [swept, setSwept] = useState(false);

  // When the grid comes near the viewport, run the green top-border through
  // the four steps in sequence (each card's transition-delay is staggered),
  // then release it so the highlight recedes in the same order — a one-shot
  // sweep, not a state that sticks. Skipped under reduced-motion.
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSwept(true);
          io.disconnect();
        }
      },
      { threshold: 0, rootMargin: "0px 0px -15% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!swept) return;
    const t = setTimeout(() => setSwept(false), 1500);
    return () => clearTimeout(t);
  }, [swept]);

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
      <div
        ref={gridRef}
        className="grid sm:grid-cols-2 lg:grid-cols-4 gap-7 mt-8"
      >
        {STEPS.map((s, i) => (
          <div
            key={s.n}
            style={{ "--d": `${i * 130}ms` } as React.CSSProperties}
            className={`border-t-2 pt-3 transition-colors duration-300 [transition-delay:var(--d)] hover:border-up hover:[transition-delay:0ms] ${
              swept ? "border-up" : "border-neutralbar"
            }`}
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
