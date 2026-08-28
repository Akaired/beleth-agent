import type { EquityPoint } from "@/lib/dashboard-queries";

/**
 * Minimal dependency-free equity curve: one polyline + a soft area fill,
 * drawn in a fixed viewBox and stretched by the container. Not an axis
 * chart — it is the "shape of the account over time" at a glance.
 */
export function EquityChart({ points }: { points: EquityPoint[] }) {
  if (points.length < 2) {
    return (
      <div className="h-[120px] flex items-center justify-center text-[12px] text-dim">
        Not enough cycles yet to draw the curve.
      </div>
    );
  }

  const W = 600;
  const H = 120;
  const values = points.map((p) => p.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = W / (points.length - 1);

  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = H - ((p.equity - min) / span) * (H - 8) - 4;
    return [x, y] as const;
  });

  const line = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${W} ${H} L0 ${H} Z`;

  const first = values[0];
  const last = values[values.length - 1];
  const up = last >= first;
  const stroke = up ? "var(--color-up)" : "var(--color-down)";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full h-[120px]"
      role="img"
      aria-label="Equity curve"
    >
      <path d={area} fill={stroke} fillOpacity={0.1} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
