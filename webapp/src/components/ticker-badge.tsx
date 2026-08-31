/**
 * Small square logo for an underlying. The agent's universe is SPY and QQQ, so
 * the real vendor mark for each is vendored under `public/tickers/` (no runtime
 * fetch, no external dependency for the judge-facing demo): `spy.svg` is the
 * State Street SPDR "SPY" wordmark, `qqq.svg` the Invesco mark, plus `iwm.svg`
 * (iShares) and `dia.svg` (SPDR) for the two on-watch candidates — all the
 * `--big` SVGs TradingView serves from s3-symbol-logo.tradingview.com. Anything
 * else falls back to a monogram tile so the component never breaks the layout.
 *
 * Client-safe: a plain <img>, no hooks — drops into Server and Client
 * Components alike.
 */

const LOGOS: Record<string, string> = {
  SPY: "/tickers/spy.svg",
  QQQ: "/tickers/qqq.svg",
  IWM: "/tickers/iwm.svg",
  DIA: "/tickers/dia.svg",
};

export function TickerBadge({
  symbol,
  size = 16,
  className = "",
}: {
  symbol: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const sym = (symbol ?? "").trim().toUpperCase();
  const src = sym ? LOGOS[sym] : undefined;
  const radius = Math.max(2, Math.round(size * 0.2));

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={sym}
        width={size}
        height={size}
        title={sym}
        style={{ width: size, height: size, borderRadius: radius }}
        className={`shrink-0 border border-line/70 bg-white object-contain ${className}`}
      />
    );
  }

  return (
    <span
      title={sym || undefined}
      style={{ width: size, height: size, borderRadius: radius, fontSize: Math.round(size * 0.42) }}
      className={`inline-flex shrink-0 items-center justify-center border border-line bg-chipbg font-mono font-semibold uppercase leading-none text-sec ${className}`}
    >
      {sym.slice(0, 3) || "—"}
    </span>
  );
}
