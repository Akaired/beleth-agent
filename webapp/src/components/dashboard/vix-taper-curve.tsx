import { taperMultiplier, type VixTaper } from "@/lib/strategy-schema";

/**
 * Inline SVG of the R9 size taper: per-trade size multiplier (y, 0–1) against
 * the VIX 1-year percentile (x). Pure render — safe in a Server Component.
 * If `currentPct` is given it is marked on the curve so the reader sees where
 * the agent sits right now.
 */
export function VixTaperCurve({
  taper,
  currentPct,
}: {
  taper: VixTaper;
  currentPct?: number | null;
}) {
  const W = 460;
  const H = 150;
  const padL = 34;
  const padR = 12;
  const padT = 12;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const xMax = Math.max(
    taper.upperPct + 6,
    (currentPct ?? 0) + 6,
    30,
  );
  const x = (pct: number) => padL + (Math.min(pct, xMax) / xMax) * plotW;
  const y = (m: number) => padT + (1 - m) * plotH;

  // Sample the piecewise line so the render matches taperMultiplier exactly.
  const pts: string[] = [];
  const steps = 120;
  for (let i = 0; i <= steps; i++) {
    const pct = (i / steps) * xMax;
    pts.push(`${x(pct).toFixed(1)},${y(taperMultiplier(pct, taper)).toFixed(1)}`);
  }
  const line = `M ${pts.join(" L ")}`;
  const area = `${line} L ${x(xMax).toFixed(1)},${y(0).toFixed(1)} L ${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;

  const blockX = taper.blockBelowPct > 0 ? x(taper.blockBelowPct) : null;
  const cur =
    currentPct !== null && currentPct !== undefined
      ? {
          px: x(currentPct),
          m: taperMultiplier(currentPct, taper),
          blocked: taper.blockBelowPct > 0 && currentPct < taper.blockBelowPct,
        }
      : null;

  const yTicks = [0, 0.5, 1];

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label="VIX-regime size taper curve"
      >
        {/* hard-block zone */}
        {blockX !== null && (
          <>
            <rect
              x={padL}
              y={padT}
              width={blockX - padL}
              height={plotH}
              fill="var(--color-down)"
              opacity={0.1}
            />
            <line
              x1={blockX}
              y1={padT}
              x2={blockX}
              y2={padT + plotH}
              stroke="var(--color-down)"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.7}
            />
          </>
        )}

        {/* y grid + labels */}
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              y1={y(t)}
              x2={W - padR}
              y2={y(t)}
              stroke="var(--color-line)"
              strokeWidth={1}
            />
            <text
              x={padL - 6}
              y={y(t) + 3}
              textAnchor="end"
              className="fill-[var(--color-faint)] font-mono"
              fontSize={9}
            >
              {t.toFixed(1)}×
            </text>
          </g>
        ))}

        {/* x labels */}
        {[0, taper.lowerPct, taper.upperPct, Math.round(xMax)]
          .filter((v, i, a) => a.indexOf(v) === i)
          .map((p) => (
            <text
              key={p}
              x={x(p)}
              y={H - 8}
              textAnchor="middle"
              className="fill-[var(--color-faint)] font-mono"
              fontSize={9}
            >
              {p}
            </text>
          ))}
        <text
          x={padL + plotW / 2}
          y={H - 8}
          textAnchor="middle"
          className="fill-[var(--color-dim)] font-mono"
          fontSize={9}
          dx={40}
        >
          VIX 1y percentile
        </text>

        <path d={area} fill="var(--color-acc)" opacity={0.12} />
        <path d={line} fill="none" stroke="var(--color-acc)" strokeWidth={2} />

        {/* current percentile marker */}
        {cur && (
          <g>
            <line
              x1={cur.px}
              y1={padT}
              x2={cur.px}
              y2={padT + plotH}
              stroke="var(--color-txt)"
              strokeWidth={1}
              strokeDasharray="2 2"
              opacity={0.5}
            />
            {!cur.blocked && (
              <circle
                cx={cur.px}
                cy={y(cur.m)}
                r={3.5}
                fill="var(--color-txt)"
              />
            )}
            <text
              x={Math.min(cur.px + 5, W - padR - 60)}
              y={padT + 10}
              className="fill-[var(--color-txt)] font-mono"
              fontSize={9}
            >
              now {currentPct!.toFixed(1)} →{" "}
              {cur.blocked ? "blocked" : `${cur.m.toFixed(2)}×`}
            </text>
          </g>
        )}
      </svg>
    </figure>
  );
}
