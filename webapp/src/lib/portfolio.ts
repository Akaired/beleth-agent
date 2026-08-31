/**
 * Client-safe types and static reference data for the backoffice "Portfolio"
 * view: the underlyings Beleth trades today and the ones lined up next.
 *
 * The live set comes from the strategy config on the most recent decision
 * (`universe.symbols`); everything Beleth could reasonably add later is listed
 * here with a fixed description. Per-instrument numbers (quote, open spreads,
 * realized P&L, cycles) are joined in `dashboard-queries.ts`.
 *
 * No `server-only` import: a Server Component renders the page, a small Client
 * Component mounts the TradingView charts, and both share these shapes.
 */

export type InstrumentStatus = "live" | "watch";

export type InstrumentMeta = {
  symbol: string;
  /** Fund name, short form. */
  name: string;
  /** The index the fund tracks. */
  tracks: string;
  /** Listing venue. */
  exchange: string;
  assetClass: string;
  /** `EXCHANGE:TICKER` for the TradingView widgets. */
  tvSymbol: string;
  /** One line on why it is in (or headed for) the universe. No paragraphs. */
  note: string;
};

/**
 * SPY and QQQ are the live universe (`config/strategy.yaml`). IWM and DIA are
 * the documented next candidates: same defined-risk structure, same liquidity
 * test, just not switched on yet.
 */
export const INSTRUMENTS: InstrumentMeta[] = [
  {
    symbol: "SPY",
    name: "SPDR S&P 500 ETF",
    tracks: "S&P 500",
    exchange: "NYSE Arca",
    assetClass: "ETF",
    tvSymbol: "AMEX:SPY",
    note: "The deepest options market in the world, penny-wide quotes, a realistic paper fill on every strike.",
  },
  {
    symbol: "QQQ",
    name: "Invesco QQQ",
    tracks: "Nasdaq 100",
    exchange: "Nasdaq",
    assetClass: "ETF",
    tvSymbol: "NASDAQ:QQQ",
    note: "Deep and liquid, usually a slightly richer volatility premium than SPY for the same tenor.",
  },
  {
    symbol: "IWM",
    name: "iShares Russell 2000 ETF",
    tracks: "Russell 2000",
    exchange: "NYSE Arca",
    assetClass: "ETF",
    tvSymbol: "AMEX:IWM",
    note: "Small caps carry a wider premium, and wider spreads to clear. Next in line once SPY and QQQ are tuned.",
  },
  {
    symbol: "DIA",
    name: "SPDR Dow Jones ETF",
    tracks: "Dow Jones Industrial Average",
    exchange: "NYSE Arca",
    assetClass: "ETF",
    tvSymbol: "AMEX:DIA",
    note: "Thirty blue chips, lower overlap with QQQ than SPY. A diversification lever, not a priority.",
  },
];

export const INSTRUMENT_BY_SYMBOL: Record<string, InstrumentMeta> =
  Object.fromEntries(INSTRUMENTS.map((i) => [i.symbol, i]));

export const DEFAULT_LIVE_SYMBOLS = ["SPY", "QQQ"];

export type InstrumentQuote = {
  /** Last trade price. */
  price: number | null;
  /** Change vs the previous close, in dollars. */
  changeAbs: number | null;
  /** Same change as a percentage. */
  changePct: number | null;
  asOf: string | null;
};

export type InstrumentStats = {
  openSpreads: number;
  unrealizedPnl: number | null;
  closed: number;
  realizedPnl: number | null;
  /** Closed round-trips that finished in profit. */
  wins: number;
  canceled: number;
  failed: number;
  /** Decision cycles the agent has run on this underlying. */
  cycles: number;
  lastAction: "trade" | "no_trade" | null;
  lastSeen: string | null;
};

export const EMPTY_STATS: InstrumentStats = {
  openSpreads: 0,
  unrealizedPnl: null,
  closed: 0,
  realizedPnl: null,
  wins: 0,
  canceled: 0,
  failed: 0,
  cycles: 0,
  lastAction: null,
  lastSeen: null,
};

export type PortfolioInstrument = InstrumentMeta & {
  status: InstrumentStatus;
  quote: InstrumentQuote | null;
  stats: InstrumentStats;
};

export type PortfolioView = {
  live: PortfolioInstrument[];
  watch: PortfolioInstrument[];
  params: {
    /** e.g. "0.15 to 0.25". */
    deltaBand: string | null;
    /** e.g. "$1 to $5". */
    strikeWidth: string | null;
    /** e.g. "7 / 14 / 21 / 30 / 45". */
    dteLadder: string | null;
  };
  /** When the strategy config snapshot was taken. */
  asOf: string | null;
  /** False when the Alpaca reads failed; the page still renders from config. */
  alpacaOk: boolean;
};
