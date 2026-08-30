/**
 * Shared TradingView embed contract — the one place the editor's insert modal,
 * the server sanitiser, and the render-side <TradingViewEmbeds> mounter agree
 * on what a stored widget looks like.
 *
 * A stored embed is an INERT placeholder, nothing more:
 *   <div class="tv-embed" data-tv-widget="…" data-tv-symbol="…" data-tv-theme="…"></div>
 *
 * The sanitiser keeps only that div, only those attributes, only a widget id in
 * TV_WIDGET_IDS, and only a symbol matching TV_SYMBOL_RE. No <script> is ever
 * allowed through the sanitiser — the real TradingView container and its
 * per-widget <script> are built in the browser at render time. TradingView's
 * embed scripts need no API key and no account; the attribution link they ship
 * with is mandatory and is always rendered.
 *
 * Client-safe (no `server-only`): imported by both the sanitiser and the
 * browser components.
 */

export type TvTheme = "light" | "dark";

export interface TvWidgetDef {
  id: string;
  label: string;
  blurb: string;
  /** Widgets like "market-overview" / "events" render without a symbol. */
  needsSymbol: boolean;
  /** Rendered height in px (the copyright strip lives inside this box). */
  height: number;
  /** The JSON config passed as the embed script's text content. */
  build: (symbol: string, theme: TvTheme) => Record<string, unknown>;
}

const SUPPORT_HOST = "https://www.tradingview.com";

export const TV_WIDGETS: readonly TvWidgetDef[] = [
  {
    id: "advanced-chart",
    label: "Advanced chart",
    blurb: "Full interactive price chart with indicators.",
    needsSymbol: true,
    height: 500,
    build: (symbol, theme) => ({
      autosize: true,
      symbol,
      interval: "D",
      timezone: "Etc/UTC",
      theme,
      style: "1",
      locale: "en",
      allow_symbol_change: false,
      hide_side_toolbar: true,
      calendar: false,
      support_host: SUPPORT_HOST,
    }),
  },
  {
    id: "symbol-overview",
    label: "Symbol overview",
    blurb: "Area chart with the key stats underneath.",
    needsSymbol: true,
    height: 440,
    build: (symbol, theme) => ({
      symbols: [[symbol, `${symbol}|1D`]],
      chartOnly: false,
      width: "100%",
      height: 440,
      locale: "en",
      colorTheme: theme,
      isTransparent: true,
      autosize: true,
      showVolume: false,
      showMA: false,
      fontColor: "rgba(120, 123, 134, 1)",
      gridLineColor: "rgba(120, 123, 134, 0.12)",
      dateRanges: ["1d|1", "1m|30", "3m|60", "12m|1D", "60m|1W", "all|1M"],
    }),
  },
  {
    id: "mini-symbol-overview",
    label: "Mini chart",
    blurb: "Compact sparkline for a single symbol.",
    needsSymbol: true,
    height: 240,
    build: (symbol, theme) => ({
      symbol,
      width: "100%",
      height: 240,
      locale: "en",
      dateRange: "12M",
      colorTheme: theme,
      isTransparent: true,
      autosize: true,
      largeChartUrl: "",
    }),
  },
  {
    id: "symbol-info",
    label: "Symbol info",
    blurb: "One-line quote header — price, change, market cap.",
    needsSymbol: true,
    height: 190,
    build: (symbol, theme) => ({
      symbol,
      width: "100%",
      locale: "en",
      colorTheme: theme,
      isTransparent: true,
    }),
  },
  {
    id: "technical-analysis",
    label: "Technical analysis",
    blurb: "Buy / sell gauge from aggregated indicators.",
    needsSymbol: true,
    height: 460,
    build: (symbol, theme) => ({
      interval: "1D",
      width: "100%",
      height: 460,
      symbol,
      showIntervalTabs: true,
      displayMode: "single",
      locale: "en",
      colorTheme: theme,
      isTransparent: true,
    }),
  },
  {
    id: "market-overview",
    label: "Market overview",
    blurb: "Tabbed watchlist of indices, FX and futures.",
    needsSymbol: false,
    height: 440,
    build: (_symbol, theme) => ({
      colorTheme: theme,
      dateRange: "12M",
      locale: "en",
      width: "100%",
      height: 440,
      isTransparent: true,
      showChart: true,
      showFloatingTooltip: true,
    }),
  },
  {
    id: "events",
    label: "Economic calendar",
    blurb: "Upcoming macro releases (US by default).",
    needsSymbol: false,
    height: 440,
    build: (_symbol, theme) => ({
      colorTheme: theme,
      isTransparent: true,
      locale: "en",
      countryFilter: "us",
      importanceFilter: "0,1",
      width: "100%",
      height: 440,
    }),
  },
] as const;

export const TV_WIDGET_BY_ID: Record<string, TvWidgetDef> = Object.fromEntries(
  TV_WIDGETS.map((w) => [w.id, w]),
);

export const TV_WIDGET_IDS: readonly string[] = TV_WIDGETS.map((w) => w.id);

/**
 * Uppercase EXCHANGE:TICKER, or a bare ticker. Digits and a few marks cover
 * futures / indices / perps, e.g. "SP:SPX", "NASDAQ:AAPL", "BINANCE:BTCUSDT.P".
 */
export const TV_SYMBOL_RE = /^[A-Z0-9]{1,12}(:[A-Z0-9._!-]{1,20})?$/;

export const TV_DEFAULT_SYMBOL = "AMEX:SPY";

export function normalizeTvSymbol(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

/** True when a `.tv-embed` div's attributes describe a widget we will render. */
export function isValidTvEmbed(
  attribs: Record<string, string | undefined>,
): boolean {
  const def = TV_WIDGET_BY_ID[attribs["data-tv-widget"] ?? ""];
  if (!def) return false;

  const theme = attribs["data-tv-theme"];
  if (theme !== "light" && theme !== "dark") return false;

  const symbol = attribs["data-tv-symbol"] ?? "";
  if (def.needsSymbol) return TV_SYMBOL_RE.test(symbol);
  return symbol === "" || TV_SYMBOL_RE.test(symbol);
}

export function tvScriptSrc(widgetId: string): string {
  return `https://s3.tradingview.com/external-embedding/embed-widget-${widgetId}.js`;
}
