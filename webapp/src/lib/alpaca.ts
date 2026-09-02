/**
 * Server-only reader for the Alpaca paper account's equity history.
 *
 * The agent never persists a continuous equity series (only per-cycle
 * `decisions.equity` snapshots, and none outside market hours), so the
 * webapp's equity curve comes straight from Alpaca's
 * `GET /v2/account/portfolio/history` endpoint, read server-side with the
 * paper keys. These are NOT `NEXT_PUBLIC_*` — they never reach the browser;
 * the client chart talks to `/api/equity`, which calls this module.
 *
 * Alpaca paper keys are full trading keys (there is no read-only variant), so
 * they widen the surface of this deploy a little: keep them server-only and in
 * Vercel's encrypted env, never in the bundle. See webapp/README.md.
 */
import "server-only";
import { DataUnavailableError } from "@/lib/supabase";
import type { MarketCalendarDay } from "@/lib/market-calendar";
import type { InstrumentQuote } from "@/lib/portfolio";
import type { PositionState, SpreadPosition } from "@/lib/positions";
import {
  DEFAULT_EQUITY_RANGE,
  spreadLabel,
  type AccountSnapshot,
  type EquityBar,
  type EquityHistory,
  type EquityRange,
  type MarketClock,
  type TradeMarker,
  type TradeMarkerState,
} from "@/lib/equity";

export {
  DEFAULT_EQUITY_RANGE,
  EQUITY_RANGES,
  isEquityRange,
  type AccountSnapshot,
  type EquityBar,
  type EquityHistory,
  type EquityRange,
  type MarketClock,
  type TradeMarker,
} from "@/lib/equity";

/** Live account balances and paper-account metadata — see `AccountSnapshot`. */
export async function fetchAccountSnapshot(): Promise<AccountSnapshot> {
  const raw = await alpacaGet<{
    account_number?: string | null;
    status?: string | null;
    currency?: string | null;
    equity?: string | number | null;
    last_equity?: string | number | null;
    cash?: string | number | null;
    portfolio_value?: string | number | null;
    long_market_value?: string | number | null;
    buying_power?: string | number | null;
    options_buying_power?: string | number | null;
    maintenance_margin?: string | number | null;
    options_approved_level?: string | number | null;
    options_trading_level?: string | number | null;
    daytrade_count?: string | number | null;
    pattern_day_trader?: boolean | null;
    trading_blocked?: boolean | null;
    account_blocked?: boolean | null;
    balance_asof?: string | null;
    created_at?: string | null;
  }>("/v2/account");
  const equity = Number(raw.equity ?? 0);
  const lastEquity = Number(raw.last_equity ?? 0);
  const dayPnl = equity - lastEquity;
  return {
    equity,
    lastEquity,
    dayPnl,
    dayPnlPct: lastEquity > 0 ? (dayPnl / lastEquity) * 100 : 0,
    asOf: raw.balance_asof ?? new Date().toISOString(),
    createdAt: raw.created_at ?? null,
    accountNumber: raw.account_number ?? null,
    status: raw.status ?? null,
    currency: raw.currency ?? null,
    cash: num(raw.cash),
    portfolioValue: num(raw.portfolio_value),
    longMarketValue: num(raw.long_market_value),
    buyingPower: num(raw.buying_power),
    optionsBuyingPower: num(raw.options_buying_power),
    maintenanceMargin: num(raw.maintenance_margin),
    optionsApprovedLevel: num(raw.options_approved_level),
    optionsTradingLevel: num(raw.options_trading_level),
    daytradeCount: num(raw.daytrade_count),
    patternDayTrader: !!raw.pattern_day_trader,
    tradingBlocked: !!raw.trading_blocked,
    accountBlocked: !!raw.account_blocked,
  };
}

/**
 * Hard ceiling on any single Alpaca call. Alpaca keys are now set in the
 * Vercel build env, so the homepage's `revalidate` prerender hits Alpaca at
 * build time; a slow or hung endpoint there would run out the 60 s build
 * worker and fail the whole deploy. Every caller fails soft on a throw.
 */
const ALPACA_TIMEOUT_MS = 8_000;

/**
 * Data-cache window for every Alpaca call. A burst of range switches or page renders
 * collapses to one upstream hit per minute — the account and the portfolio history do
 * not move faster than that, and the paper API is rate limited. It was written out at
 * each of the three fetches.
 */
const ALPACA_CACHE_SECONDS = 60;

function alpacaCreds(): { key: string; secret: string } {
  const key = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!key || !secret) {
    throw new DataUnavailableError(
      "Alpaca env not configured (ALPACA_API_KEY / ALPACA_SECRET_KEY)",
    );
  }
  return { key, secret };
}

async function alpacaGet<T>(path: string): Promise<T> {
  const { key, secret } = alpacaCreds();
  let res: Response;
  try {
    res = await fetch(`${alpacaBaseUrl()}${path}`, {
      headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret },
      next: { revalidate: ALPACA_CACHE_SECONDS },
      signal: AbortSignal.timeout(ALPACA_TIMEOUT_MS),
    });
  } catch (err) {
    throw new DataUnavailableError(
      `Alpaca ${path} unreachable: ${(err as Error).message}`,
    );
  }
  if (!res.ok) {
    throw new DataUnavailableError(`Alpaca ${path} HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

type RangeSpec = { period: string; timeframe: string; intraday: boolean };

// Alpaca `period` units: D(ay) W(eek) M(onth) A(nnum). Intraday timeframes are
// only valid for short periods, so the ladder widens the bucket as it lengthens.
const RANGE_SPEC: Record<EquityRange, RangeSpec> = {
  "1D": { period: "1D", timeframe: "5Min", intraday: true },
  "1W": { period: "1W", timeframe: "15Min", intraday: true },
  "1M": { period: "1M", timeframe: "1H", intraday: true },
  ALL: { period: "1A", timeframe: "1D", intraday: false },
};

type RawHistory = {
  timestamp?: number[];
  equity?: Array<number | null>;
  base_value?: number | null;
};

function alpacaBaseUrl(): string {
  // Paper only — the agent enforces the same at its config layer.
  return (
    process.env.ALPACA_API_BASE_URL?.replace(/\/+$/, "") ??
    "https://paper-api.alpaca.markets"
  );
}

function alpacaDataBaseUrl(): string {
  return (
    process.env.ALPACA_DATA_BASE_URL?.replace(/\/+$/, "") ??
    "https://data.alpaca.markets"
  );
}

// --- Stock snapshots ----------------------------------------------------------

type RawSnapshotBar = { c?: number | null; t?: string | null };
type RawStockSnapshot = {
  latestTrade?: { p?: number | null; t?: string | null } | null;
  minuteBar?: RawSnapshotBar | null;
  dailyBar?: RawSnapshotBar | null;
  prevDailyBar?: RawSnapshotBar | null;
};

/**
 * Latest price and day change for each underlying, from the Alpaca Market Data
 * API (`GET /v2/stocks/snapshots`, free IEX feed). Returns one `InstrumentQuote`
 * per symbol that resolved; a symbol Alpaca did not return is simply absent.
 * Throws `DataUnavailableError` on a missing key or non-2xx so the caller can
 * fail soft.
 */
export async function fetchStockSnapshots(
  symbols: string[],
): Promise<Record<string, InstrumentQuote>> {
  const wanted = Array.from(new Set(symbols.map((s) => s.toUpperCase()))).filter(
    Boolean,
  );
  if (wanted.length === 0) return {};

  const { key, secret } = alpacaCreds();
  const url = new URL(`${alpacaDataBaseUrl()}/v2/stocks/snapshots`);
  url.searchParams.set("symbols", wanted.join(","));

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret },
      next: { revalidate: ALPACA_CACHE_SECONDS },
      signal: AbortSignal.timeout(ALPACA_TIMEOUT_MS),
    });
  } catch (err) {
    throw new DataUnavailableError(
      `Alpaca stocks/snapshots unreachable: ${(err as Error).message}`,
    );
  }
  if (!res.ok) {
    throw new DataUnavailableError(`Alpaca stocks/snapshots HTTP ${res.status}`);
  }

  // Alpaca returns the map either at the top level (`{ "SPY": {…} }`) or nested
  // under `snapshots` depending on the endpoint; accept both.
  const raw = (await res.json()) as Record<string, unknown>;
  const nested = raw.snapshots;
  const bySymbol = (
    nested && typeof nested === "object" ? nested : raw
  ) as Record<string, RawStockSnapshot>;

  const out: Record<string, InstrumentQuote> = {};
  for (const sym of wanted) {
    const snap = bySymbol[sym];
    if (!snap) continue;
    const price =
      num(snap.latestTrade?.p) ??
      num(snap.minuteBar?.c) ??
      num(snap.dailyBar?.c);
    const prevClose = num(snap.prevDailyBar?.c);
    const changeAbs =
      price != null && prevClose != null ? price - prevClose : null;
    out[sym] = {
      price,
      changeAbs,
      changePct:
        changeAbs != null && prevClose ? (changeAbs / prevClose) * 100 : null,
      asOf: snap.latestTrade?.t ?? snap.dailyBar?.t ?? null,
    };
  }
  return out;
}

/**
 * Fetch and normalise the portfolio history for one range. Throws
 * `DataUnavailableError` on missing credentials, a non-2xx response, or an
 * unusable payload — every caller is expected to fail soft.
 */
export async function fetchEquityHistory(
  range: EquityRange = DEFAULT_EQUITY_RANGE,
): Promise<EquityHistory> {
  const { key, secret } = alpacaCreds();

  const spec = RANGE_SPEC[range];
  const url = new URL(`${alpacaBaseUrl()}/v2/account/portfolio/history`);
  url.searchParams.set("period", spec.period);
  url.searchParams.set("timeframe", spec.timeframe);
  url.searchParams.set("intraday_reporting", "market_hours");
  url.searchParams.set("pnl_reset", "no_reset");

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret },
      next: { revalidate: ALPACA_CACHE_SECONDS },
      signal: AbortSignal.timeout(ALPACA_TIMEOUT_MS),
    });
  } catch (err) {
    throw new DataUnavailableError(
      `Alpaca portfolio/history unreachable: ${(err as Error).message}`,
    );
  }
  if (!res.ok) {
    throw new DataUnavailableError(`Alpaca portfolio/history HTTP ${res.status}`);
  }

  const raw = (await res.json()) as RawHistory;
  const times = raw.timestamp ?? [];
  const equities = raw.equity ?? [];

  const points: EquityBar[] = [];
  for (let i = 0; i < times.length; i += 1) {
    const t = times[i];
    const v = equities[i];
    // Drop points before the account was funded (Alpaca reports 0 / null there)
    // and enforce a strictly increasing time axis for lightweight-charts.
    if (typeof t !== "number" || typeof v !== "number" || v <= 0) continue;
    if (points.length > 0 && t <= points[points.length - 1].time) continue;
    points.push({ time: t, value: Math.round(v * 100) / 100 });
  }

  // `portfolio/history` only carries completed market-hours bars, so its last
  // point lags the account and can disagree with it (notably over a weekend, or
  // for an option position being re-marked). Pin the tail to the live account
  // equity so the chart's "latest" equals the overview's Equity figure.
  if (points.length > 0) {
    try {
      const snap = await fetchAccountSnapshot();
      if (snap.equity > 0) {
        const nowSec = Math.floor(Date.now() / 1000);
        const tail = points[points.length - 1];
        const liveValue = Math.round(snap.equity * 100) / 100;
        if (nowSec > tail.time) {
          points.push({ time: nowSec, value: liveValue });
        } else {
          tail.value = liveValue;
        }
      }
    } catch {
      // Keep the raw history if the account call fails.
    }
  }

  const startEquity = points.length > 0 ? points[0].value : 0;
  const lastEquity =
    points.length > 0 ? points[points.length - 1].value : startEquity;
  const baseValue =
    typeof raw.base_value === "number" && raw.base_value > 0
      ? raw.base_value
      : startEquity;
  const changeAbs = lastEquity - startEquity;

  return {
    range,
    points,
    baseValue,
    startEquity,
    lastEquity,
    changeAbs,
    changePct: startEquity > 0 ? (changeAbs / startEquity) * 100 : 0,
    intraday: spec.intraday,
  };
}

// --- Market clock ---------------------------------------------------------------

/** Real-time NYSE session state from Alpaca's clock. */
export async function fetchMarketClock(): Promise<MarketClock> {
  const raw = await alpacaGet<{
    is_open?: boolean;
    next_open?: string | null;
    next_close?: string | null;
  }>("/v2/clock");
  return {
    isOpen: !!raw.is_open,
    nextOpen: raw.next_open ?? null,
    nextClose: raw.next_close ?? null,
  };
}

// --- Market calendar ------------------------------------------------------------

type RawCalendarDay = {
  date?: string;
  open?: string;
  close?: string;
};

/**
 * The exchange trading calendar for `[start, end]` (inclusive, `YYYY-MM-DD`)
 * from Alpaca `GET /v2/calendar`. Only open days come back; a weekday absent
 * from the result is a market holiday. `open` / `close` are `HH:MM` US/Eastern
 * and carry early closes (e.g. `13:00`). Throws `DataUnavailableError` on a
 * missing key or non-2xx so the page can fail soft.
 */
export async function fetchMarketCalendar(
  start: string,
  end: string,
): Promise<MarketCalendarDay[]> {
  const raw = await alpacaGet<RawCalendarDay[]>(
    `/v2/calendar?start=${start}&end=${end}`,
  );
  const out: MarketCalendarDay[] = [];
  for (const d of raw) {
    if (!d.date || !d.open || !d.close) continue;
    out.push({ date: d.date, open: d.open, close: d.close });
  }
  return out;
}

// --- Trade markers ----------------------------------------------------------

type AlpacaLeg = {
  symbol?: string;
  side?: string;
  position_intent?: string;
  filled_qty?: string | number | null;
  filled_avg_price?: string | number | null;
};

type AlpacaOrder = {
  id?: string;
  order_class?: string;
  status?: string;
  filled_qty?: string | number | null;
  filled_avg_price?: string | number | null;
  filled_at?: string | null;
  legs?: AlpacaLeg[] | null;
  client_order_id?: string | null;
  qty?: string | number | null;
  submitted_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  canceled_at?: string | null;
  expired_at?: string | null;
};

type AlpacaPosition = {
  symbol?: string;
  qty?: string | number | null;
  asset_class?: string | null;
  avg_entry_price?: string | number | null;
  market_value?: string | number | null;
  unrealized_pl?: string | number | null;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Strike out of an OCC option symbol, e.g. SPY261009C00799000 -> 799. */
function strikeOf(symbol: string): number | null {
  const m = /[CP](\d{8})$/.exec(symbol);
  return m ? Number(m[1]) / 1000 : null;
}

function rightOf(symbol: string): "C" | "P" | null {
  const m = /(\d{6})([CP])\d{8}$/.exec(symbol);
  return m ? (m[2] as "C" | "P") : null;
}

/** OCC expiry `YYMMDD` out of an option symbol, e.g. SPY261009C… -> "261009". */
function expiryOf(symbol: string): string | null {
  const m = /(\d{6})[CP]\d{8}$/.exec(symbol);
  return m ? m[1] : null;
}

function rootOf(symbol: string): string {
  return symbol.replace(/\d{6}[CP]\d{8}$/, "") || symbol;
}

/**
 * Filled option spreads on the paper account, as chart markers — entries still
 * open, entries since closed, and closing fills, kept distinct. Resting,
 * canceled, expired and rejected orders are never plotted.
 *
 * Sources: `GET /v2/orders?status=closed` (every terminal order, `filled_qty`
 * tells us which actually filled) joined against `GET /v2/positions` (which
 * fills are still on the book).
 */
export async function fetchTradeMarkers(): Promise<TradeMarker[]> {
  const [orders, positions] = await Promise.all([
    alpacaGet<AlpacaOrder[]>(
      "/v2/orders?status=closed&nested=true&limit=500&direction=asc",
    ),
    alpacaGet<AlpacaPosition[]>("/v2/positions"),
  ]);

  const openSymbols = new Set(
    positions
      .filter((p) => (num(p.qty) ?? 0) !== 0)
      .map((p) => p.symbol)
      .filter((s): s is string => !!s),
  );

  const markers: TradeMarker[] = [];
  for (const order of orders) {
    if (order.order_class !== "mleg") continue;
    if ((num(order.filled_qty) ?? 0) <= 0 || !order.filled_at) continue;
    const legs = order.legs ?? [];
    if (legs.length < 2) continue;

    const intents = legs.map((l) => l.position_intent ?? "");
    const isExit = intents.some((i) => i.endsWith("_to_close"));
    const isEntry = intents.some((i) => i.endsWith("_to_open"));
    if (!isEntry && !isExit) continue;

    // The short leg is sold to open / bought to close; the long leg the mirror.
    const shortLeg =
      legs.find(
        (l) =>
          l.position_intent === "sell_to_open" ||
          l.position_intent === "buy_to_close",
      ) ?? legs.find((l) => l.side === "sell");
    const longLeg = legs.find((l) => l !== shortLeg) ?? null;

    const symbols = legs.map((l) => l.symbol).filter((s): s is string => !!s);
    const stillOpen =
      isEntry && symbols.length > 0 && symbols.every((s) => openSymbols.has(s));
    const state: TradeMarkerState = isExit
      ? "exit"
      : stillOpen
        ? "open"
        : "closed";

    const anySymbol = symbols[0] ?? "";
    const shortStrike = shortLeg?.symbol ? strikeOf(shortLeg.symbol) : null;
    const longStrike = longLeg?.symbol ? strikeOf(longLeg.symbol) : null;
    const right = anySymbol ? rightOf(anySymbol) : null;

    markers.push({
      time: Math.floor(new Date(order.filled_at).getTime() / 1000),
      filledAt: order.filled_at,
      state,
      underlying: anySymbol ? rootOf(anySymbol) : "?",
      right,
      qty: num(order.filled_qty),
      net: num(order.filled_avg_price),
      shortLeg:
        shortStrike !== null
          ? { strike: shortStrike, price: num(shortLeg?.filled_avg_price) }
          : null,
      longLeg:
        longStrike !== null
          ? { strike: longStrike, price: num(longLeg?.filled_avg_price) }
          : null,
      spread: spreadLabel(right, shortStrike, longStrike),
    });
  }

  markers.sort((a, b) => a.time - b.time);
  return markers;
}

// --- Spread positions (backoffice) ----------------------------------------

function sumBy<T>(items: T[], pick: (t: T) => number | null): number | null {
  let acc: number | null = null;
  for (const it of items) {
    const v = pick(it);
    if (v != null) acc = (acc ?? 0) + v;
  }
  return acc;
}

/**
 * Every spread the agent has opened or tried to open on the paper account,
 * reconstructed from Alpaca and classified: `open` (both legs still on the
 * book, with live unrealized P&L), `closed` (a filled entry matched to a
 * filled exit — realized P&L), `canceled` (an entry order that terminated
 * unfilled), `failed` (an entry order rejected by Alpaca).
 *
 * Pre-submission failures (rejected by our own risk gate, never sent) are NOT
 * here — they have no Alpaca order; `dashboard-queries` adds them from the
 * `trades` table. Throws `DataUnavailableError` when Alpaca is unreachable so
 * the page can fail soft.
 */
export async function fetchSpreadPositions(): Promise<SpreadPosition[]> {
  const [orders, positions] = await Promise.all([
    alpacaGet<AlpacaOrder[]>(
      "/v2/orders?status=closed&nested=true&limit=500&direction=asc",
    ),
    alpacaGet<AlpacaPosition[]>("/v2/positions"),
  ]);

  // Live per-leg P&L, keyed by option symbol, for merging onto open rows.
  const legLive = new Map<
    string,
    { mv: number | null; upl: number | null }
  >();
  for (const p of positions) {
    if (!p.symbol || (num(p.qty) ?? 0) === 0) continue;
    legLive.set(p.symbol, {
      mv: num(p.market_value),
      upl: num(p.unrealized_pl),
    });
  }
  const openLegSymbols = new Set(legLive.keys());

  const mleg = orders.filter((o) => o.order_class === "mleg");

  // Filled closing orders, indexed for round-trip matching against entries.
  const filledExits = mleg
    .filter((o) => {
      const intents = (o.legs ?? []).map((l) => l.position_intent ?? "");
      return (
        intents.some((i) => i.endsWith("_to_close")) &&
        (num(o.filled_qty) ?? 0) > 0 &&
        !!o.filled_at
      );
    })
    .map((o) => ({
      order: o,
      symbols: new Set(
        (o.legs ?? [])
          .map((l) => l.symbol)
          .filter((s): s is string => !!s),
      ),
      at: new Date(o.filled_at as string).getTime(),
    }));

  const out: SpreadPosition[] = [];
  const seenOpen = new Set<string>();

  for (const o of mleg) {
    const legs = o.legs ?? [];
    if (legs.length < 2) continue;

    const intents = legs.map((l) => l.position_intent ?? "");
    if (!intents.some((i) => i.endsWith("_to_open"))) continue; // exits ride their entry

    const symbols = legs
      .map((l) => l.symbol)
      .filter((s): s is string => !!s);
    const shortLeg =
      legs.find((l) => l.position_intent === "sell_to_open") ??
      legs.find((l) => l.side === "sell");
    const longLeg = legs.find((l) => l !== shortLeg) ?? null;
    const shortStrike = shortLeg?.symbol ? strikeOf(shortLeg.symbol) : null;
    const longStrike = longLeg?.symbol ? strikeOf(longLeg.symbol) : null;
    const right = symbols[0] ? rightOf(symbols[0]) : null;
    const underlying = symbols[0] ? rootOf(symbols[0]) : "?";
    const qty = num(o.filled_qty) ?? num(o.qty);
    const filled = (num(o.filled_qty) ?? 0) > 0 && !!o.filled_at;

    const width =
      shortStrike != null && longStrike != null
        ? Math.abs(shortStrike - longStrike)
        : null;

    const expiry =
      (shortLeg?.symbol && expiryOf(shortLeg.symbol)) ||
      (symbols[0] && expiryOf(symbols[0])) ||
      null;

    const common = {
      underlying,
      right,
      qty,
      spread: spreadLabel(right, shortStrike, longStrike),
      shortStrike,
      longStrike,
      expiry,
      clientOrderId: o.client_order_id ?? null,
      exitClientOrderId: null as string | null,
      exitReason: null as string | null,
      decisionId: null as string | null,
    };

    if (!filled) {
      const status = o.status ?? "unknown";
      const state: PositionState = status === "rejected" ? "failed" : "canceled";
      out.push({
        ...common,
        id: o.id ?? `order:${common.clientOrderId ?? symbols.join(",")}`,
        state,
        entryCredit: null,
        exitDebit: null,
        realizedPnl: null,
        unrealizedPnl: null,
        marketValue: null,
        maxLoss: null,
        openedAt: o.submitted_at ?? o.created_at ?? null,
        closedAt: o.canceled_at ?? o.expired_at ?? o.updated_at ?? null,
        failureReason: state === "failed" ? "rejected by Alpaca" : null,
        alpacaStatus: status,
      });
      continue;
    }

    // filled entry: `filled_avg_price` is signed — negative = net credit.
    const entryNet = num(o.filled_avg_price);
    const entryCredit = entryNet != null ? -entryNet : null;
    const maxLoss =
      width != null && entryCredit != null && qty != null
        ? Math.max(0, (width - entryCredit) * 100 * qty)
        : null;

    const stillOpen =
      symbols.length > 0 && symbols.every((s) => openLegSymbols.has(s));

    if (stillOpen) {
      const key = symbols.slice().sort().join(",");
      if (seenOpen.has(key)) continue;
      seenOpen.add(key);
      const live = symbols.map((s) => legLive.get(s)).filter((x) => !!x) as {
        mv: number | null;
        upl: number | null;
      }[];
      out.push({
        ...common,
        id: o.id ?? `open:${key}`,
        state: "open",
        entryCredit,
        exitDebit: null,
        realizedPnl: null,
        unrealizedPnl: sumBy(live, (l) => l.upl),
        marketValue: sumBy(live, (l) => l.mv),
        maxLoss,
        openedAt: o.filled_at ?? null,
        closedAt: null,
        failureReason: null,
        alpacaStatus: "open",
      });
      continue;
    }

    // round-trip: earliest filled exit that shares a leg and is not older.
    const entryAt = o.filled_at ? new Date(o.filled_at).getTime() : 0;
    const match = filledExits
      .filter((e) => e.at >= entryAt && symbols.some((s) => e.symbols.has(s)))
      .sort((a, b) => a.at - b.at)[0];

    const exitNet = match ? num(match.order.filled_avg_price) : null;
    const realizedPnl =
      entryCredit != null && exitNet != null && qty != null
        ? (entryCredit - exitNet) * 100 * qty
        : null;

    out.push({
      ...common,
      id: o.id ?? `closed:${symbols.join(",")}`,
      state: "closed",
      entryCredit,
      exitDebit: exitNet,
      realizedPnl,
      unrealizedPnl: null,
      marketValue: null,
      maxLoss,
      openedAt: o.filled_at ?? null,
      closedAt: match?.order.filled_at ?? null,
      failureReason: null,
      alpacaStatus: o.status ?? "filled",
      exitClientOrderId: match?.order.client_order_id ?? null,
    });
  }

  return out;
}
