"use client";

/**
 * Internal preview of every reactive-mascot scene. Not linked in navigation —
 * reach it at /beleth. Each scene is a CSS-only skit (globals.css); in
 * production the server picks exactly one from live agent + market state
 * (src/lib/beleth.ts, wired into the homepage hero).
 */
import { useState } from "react";
import { BelethSprite } from "@/components/beleth-sprite";
import {
  BELETH_SCENE_META,
  BELETH_SCENE_ORDER,
  type BelethPnl,
  type BelethScene,
} from "@/lib/beleth";

const PNL_OPTIONS: { value: BelethPnl; label: string }[] = [
  { value: null, label: "flat" },
  { value: "up", label: "day up" },
  { value: "down", label: "day down" },
];

export default function BelethGalleryPage() {
  const [stageScene, setStageScene] = useState<BelethScene>("guard");
  const [pnl, setPnl] = useState<BelethPnl>(null);
  const [frozen, setFrozen] = useState(false);

  const stageMeta = BELETH_SCENE_META[stageScene];

  return (
    <div className="min-h-screen bg-bg text-txt">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 md:px-8">
        <header className="border-b border-line pb-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-dim">
            Internal preview · not linked in navigation
          </p>
          <h1 className="mt-2 font-sans text-[26px] font-light tracking-[-0.01em]">
            Beleth — reactive scenes
          </h1>
          <p className="mt-2 max-w-[70ch] text-[13px] leading-[1.6] text-sec">
            Every scene is CSS-only — props live in the SVG at{" "}
            <code className="font-mono text-[12px] text-txt">opacity:0</code> and
            are revealed by a single{" "}
            <code className="font-mono text-[12px] text-txt">data-scene</code>{" "}
            attribute. In production the server derives that one value from the
            agent status, the latest decision and the market clock (
            <code className="font-mono text-[12px] text-txt">
              src/lib/beleth.ts
            </code>
            ). The day-P&amp;L tint is independent of the scene.
          </p>
        </header>

        {/* ---- stage ---- */}
        <section className="mt-8 grid gap-6 md:grid-cols-[minmax(0,380px)_1fr]">
          <div
            className={`flex items-center justify-center rounded-lg border border-line bg-panel p-10 ${
              frozen ? "beleth-freeze" : ""
            }`}
          >
            <div className="w-full max-w-[320px]">
              <BelethSprite scene={stageScene} pnl={pnl} />
            </div>
          </div>

          <div className="flex flex-col gap-5">
            <div>
              <div className="flex items-baseline gap-2">
                <span className="rounded-[2px] bg-chipbg px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-acc">
                  {stageMeta.label}
                </span>
                <code className="font-mono text-[11px] text-dim">
                  data-scene=&quot;{stageScene}&quot;
                </code>
              </div>
              <p className="mt-3 text-[15px] text-txt">{stageMeta.caption}</p>
              <p className="mt-1 max-w-[60ch] text-[13px] leading-[1.55] text-sec">
                {stageMeta.trigger}
              </p>
            </div>

            <div>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
                Scene
              </p>
              <div className="flex flex-wrap gap-1.5">
                {BELETH_SCENE_ORDER.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStageScene(s)}
                    className={`rounded-[3px] border px-2.5 py-1.5 font-mono text-[11px] transition-colors ${
                      s === stageScene
                        ? "border-acc bg-sel text-txt"
                        : "border-inputline text-sec hover:border-hoverline hover:text-txt"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-8">
              <div>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
                  Day P&amp;L tint
                </p>
                <div className="flex gap-1.5">
                  {PNL_OPTIONS.map((o) => (
                    <button
                      key={o.label}
                      type="button"
                      onClick={() => setPnl(o.value)}
                      className={`rounded-[3px] border px-2.5 py-1.5 font-mono text-[11px] transition-colors ${
                        o.value === pnl
                          ? "border-acc bg-sel text-txt"
                          : "border-inputline text-sec hover:border-hoverline hover:text-txt"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-dim">
                  Motion
                </p>
                <button
                  type="button"
                  onClick={() => setFrozen((v) => !v)}
                  className={`rounded-[3px] border px-2.5 py-1.5 font-mono text-[11px] transition-colors ${
                    frozen
                      ? "border-acc bg-sel text-txt"
                      : "border-inputline text-sec hover:border-hoverline hover:text-txt"
                  }`}
                >
                  {frozen ? "reduced-motion: on" : "reduced-motion: off"}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ---- full grid ---- */}
        <section className="mt-12">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim">
            All scenes ({BELETH_SCENE_ORDER.length})
          </h2>
          <div
            className={`mt-4 grid gap-4 sm:grid-cols-2 ${
              frozen ? "beleth-freeze" : ""
            }`}
          >
            {BELETH_SCENE_ORDER.map((s) => {
              const meta = BELETH_SCENE_META[s];
              return (
                <article
                  key={s}
                  className="flex flex-col rounded-lg border border-line bg-panel"
                >
                  <div className="flex items-center justify-center border-b border-rowline px-6 py-10">
                    <div className="w-full max-w-[240px]">
                      <BelethSprite scene={s} pnl={pnl} />
                    </div>
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5 p-4">
                    <div className="flex items-center gap-2">
                      <span className="rounded-[2px] bg-chipbg px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-acc">
                        {meta.label}
                      </span>
                      <code className="font-mono text-[10px] text-dim">{s}</code>
                    </div>
                    <p className="text-[13px] text-txt">{meta.caption}</p>
                    <p className="text-[12px] leading-[1.5] text-sec">
                      {meta.trigger}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
