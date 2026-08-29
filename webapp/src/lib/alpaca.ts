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

/** Live account balances — see `AccountSnapshot`. */
export async function fetchAccountSnapshot(): Promise<AccountSnapshot> {
  const raw = await alpacaGet<{
    equity?: string | number | null;
    last_equity?: string | number | null;
    balance_asof?: string | null;
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
  };
}

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
      next: { revalidate: 60 },
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
      // Data-cache the upstream call so a burst of range switches or page
      // renders collapses to one Alpaca hit per minute.
      next: { revalidate: 60 },
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
};

type AlpacaPosition = { symbol?: string; qty?: string | number | null };

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
