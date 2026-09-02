/**
 * Authenticated dashboard reads. These go through the SSR Supabase client
 * (cookie session, `authenticated` RLS role) rather than the anon PostgREST
 * reader the public homepage uses. Reads only — the agent owns every write.
 *
 * Row visibility today is identical for every signed-in role (0003 grants
 * `authenticated` a permissive SELECT on all data tables); the difference
 * between the public-user view and the demo-admin backoffice is enforced in
 * the page layer (which columns/pages we render), not yet in RLS.
 */
import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  fetchAccountSnapshot,
  fetchEquityHistory,
  fetchMarketCalendar,
  fetchMarketClock,
  fetchSpreadPositions,
  fetchStockSnapshots,
  fetchTradeMarkers,
  DEFAULT_EQUITY_RANGE,
} from "@/lib/alpaca";
import {
  DEFAULT_LIVE_SYMBOLS,
  EMPTY_STATS,
  INSTRUMENTS,
  INSTRUMENT_BY_SYMBOL,
  type InstrumentMeta,
  type InstrumentQuote,
  type InstrumentStats,
  type PortfolioInstrument,
  type PortfolioView,
} from "@/lib/portfolio";
import { matrixRange, nyDateKey } from "@/lib/month-grid";
import type { MarketCalendarDay } from "@/lib/market-calendar";
import type { MarketClock } from "@/lib/equity";
import type { TradeCalendarDay } from "@/lib/trade-calendar";
import {
  spreadLabel,
  type AccountSnapshot,
  type EquityHistory,
  type TradeMarker,
} from "@/lib/equity";
import type { SpreadPosition } from "@/lib/positions";
import type { HostHistoryPoint } from "@/lib/host";
import type { AgentEvent } from "@/lib/events";
import { AGENT_STATUS_COLS, AGENT_STATUS_ID } from "@/lib/schema";
import { DECISIONS_PAGE_SIZE } from "@/lib/pagination";
import {
  deriveOrderOutcome,
  type AgentStatusRow,
  type DecisionRow,
  type EvidencePackage,
} from "@/lib/queries";

export type { AgentStatusRow, DecisionRow, EvidencePackage, TradeMarker };
export type { SpreadPosition } from "@/lib/positions";

/** A decision plus the backoffice-only columns (demo_admin and up). */
export type DecisionDetailRow = DecisionRow & {
  agent_version: string;
  llm_reasoning: string | null;
  llm_usage: Record<string, number> | null;
  strategy_config: Record<string, unknown> | null;
};

export type RiskCheckRow = {
  id: string;
  candidate_index: number;
  rule: string;
  passed: boolean;
  approved: boolean;
  reason: string;
  detail: Record<string, unknown>;
  candidate: Record<string, unknown>;
  max_loss: string | null;
  breakeven: string | null;
};

export type TradeRow = {
  id: string;
  created_at: string;
  underlying: string;
  kind: "entry" | "exit";
  exit_reason: string | null;
  alpaca_order_id: string | null;
  client_order_id: string | null;
  status: string | null;
  qty: string | null;
  filled_qty: string | null;
  filled_avg_price: string | null;
  credit: string | null;
  max_loss: string | null;
  legs: unknown;
};

export type DashboardOverview = {
  latestDecision: DecisionRow | null;
  agentStatus: AgentStatusRow | null;
  recentDecisions: DecisionRow[];
  equity: EquityHistory | null;
  account: AccountSnapshot | null;
  tradeMarkers: TradeMarker[];
  marketOpen: boolean | null;
  cyclesRun: number;
  tradesSubmitted: number;
  refused: number;
  firstDecisionAt: string | null;
  openPositions: number;
};

const DECISION_COLS =
  "id,created_at,as_of,symbol,action,summary,market_open,equity,day_pnl,decision_source,llm_model,evidence";

/**
 * Soft deadline for a best-effort dependency of the overview.
 *
 * The authenticated dashboard is server-rendered *inline in the response to the
 * sign-in Server Action* (`redirect("/dashboard")`), so the login button's
 * pending spinner stays up until `fetchDashboardOverview` resolves. The
 * Alpaca-derived panels (equity curve, paper-account box, MARKET chip, order
 * markers) are all refreshed on the client right after mount — `<EquityCurve>`
 * hits `/api/equity`, `<LiveRefresh>` re-runs the page — so when Alpaca is slow
 * we render the shell now with `fallback` and let the client fill in, rather
 * than making the operator watch a spinner for the full 8 s per-call ceiling.
 */
const OVERVIEW_ALPACA_DEADLINE_MS = 3_000;

function withDeadline<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

/**
 * The full decision — including `llm_reasoning`, the model's unedited output — comes
 * from `beleth_decision_detail`, a SECURITY DEFINER reader gated to demo_admin and
 * master_admin (0034). Selecting the column directly worked only because `decisions`
 * is anon-readable, which made the UI's gate cosmetic: the anon key and one PostgREST
 * call returned the same text. 0035 revokes the column; this call keeps working.
 */

/** Everything the public-user dashboard needs, in one batch. */
export async function fetchDashboardOverview(): Promise<DashboardOverview> {
  const supabase = await createClient();

  let markersLive = false;
  const [
    latest,
    recent,
    tradeMarkers,
    first,
    status,
    cycles,
    trades,
    refusedRows,
    positions,
    equity,
    clock,
    account,
  ] = await Promise.all([
    supabase
      .from("decisions")
      .select(DECISION_COLS)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("decisions")
      .select(DECISION_COLS)
      .order("created_at", { ascending: false })
      .limit(12),
    withDeadline(
      fetchTradeMarkers()
        .then((m) => {
          markersLive = true;
          return m;
        })
        .catch((err) => {
          console.error("dashboard trade markers fetch failed", err);
          return [] as TradeMarker[];
        }),
      OVERVIEW_ALPACA_DEADLINE_MS,
      [] as TradeMarker[],
    ),
    supabase
      .from("decisions")
      .select("created_at")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("agent_status")
      .select(AGENT_STATUS_COLS)
      .eq("id", AGENT_STATUS_ID)
      .maybeSingle(),
    supabase
      .from("decisions")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("trades")
      .select("id", { count: "exact", head: true })
      .eq("kind", "entry")
      .not("alpaca_order_id", "is", null),
    supabase
      .from("risk_checks")
      .select("decision_id,candidate_index")
      .eq("approved", false)
      .neq("rule", "R5"),
    // Count spreads, not legs: `positions` mirrors every option leg (a vertical is
    // two rows), and each defined-risk vertical has exactly one short leg — the same
    // definition the homepage stat and the sidebar badge use.
    supabase
      .from("positions")
      .select("symbol", { count: "exact", head: true })
      .eq("side", "short"),
    // Alpaca is a separate dependency — a failure (or a slow call past the
    // soft deadline) just drops the panel; the client refreshes it after mount.
    withDeadline(
      fetchEquityHistory(DEFAULT_EQUITY_RANGE).catch((err) => {
        console.error("dashboard equity history fetch failed", err);
        return null;
      }),
      OVERVIEW_ALPACA_DEADLINE_MS,
      null,
    ),
    withDeadline(
      fetchMarketClock().catch((err) => {
        console.error("dashboard market clock fetch failed", err);
        return null;
      }),
      OVERVIEW_ALPACA_DEADLINE_MS,
      null,
    ),
    withDeadline(
      fetchAccountSnapshot().catch((err) => {
        console.error("dashboard account snapshot fetch failed", err);
        return null;
      }),
      OVERVIEW_ALPACA_DEADLINE_MS,
      null,
    ),
  ]);

  const refused = new Set(
    (refusedRows.data ?? []).map(
      (r) => `${r.decision_id}:${r.candidate_index}`,
    ),
  ).size;

  // Resolve `orderOutcome` for the decisions we render, so a `trade` decision
  // that was stood down by the marketability gate is not labelled a live order.
  const decisionsWithOutcome = await attachOrderOutcomes(supabase, [
    ...((latest.data ? [latest.data] : []) as DecisionRow[]),
    ...((recent.data as DecisionRow[] | null) ?? []),
  ]);
  const latestWithOutcome =
    decisionsWithOutcome.find((d) => d.id === (latest.data as DecisionRow | null)?.id) ??
    null;
  const recentWithOutcome = ((recent.data as DecisionRow[] | null) ?? []).map(
    (r) => decisionsWithOutcome.find((d) => d.id === r.id) ?? r,
  );

  // Trades that actually executed on the paper account: an entry marker
  // exists only for a filled order, so canceled / expired / rejected orders
  // are excluded, and "exit" markers are a round trip's closing leg, not a
  // new trade. Falls back to the Supabase submitted count only when Alpaca
  // is unreachable.
  const tradesFilled = markersLive
    ? tradeMarkers.filter((m) => m.state === "open" || m.state === "closed")
        .length
    : (trades.count ?? 0);

  return {
    latestDecision: latestWithOutcome,
    agentStatus: (status.data as AgentStatusRow | null) ?? null,
    recentDecisions: recentWithOutcome,
    equity,
    account,
    tradeMarkers,
    marketOpen: clock?.isOpen ?? null,
    cyclesRun: cycles.count ?? 0,
    tradesSubmitted: tradesFilled,
    refused,
    firstDecisionAt:
      (first.data as { created_at: string } | null)?.created_at ?? null,
    openPositions: positions.count ?? 0,
  };
}

/**
 * Fill `orderOutcome` on each decision by loading the `trades` rows the same
 * cycle wrote. One round trip regardless of how many rows are passed;
 * `no_trade` decisions resolve to `null` without hitting the table.
 */
async function attachOrderOutcomes<T extends DecisionRow>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: T[],
): Promise<T[]> {
  const tradeDecisionIds = rows
    .filter((r) => r.action === "trade")
    .map((r) => r.id);

  const byDecision = new Map<
    string,
    { alpaca_order_id: string | null; status: string | null }[]
  >();
  if (tradeDecisionIds.length > 0) {
    const { data } = await supabase
      .from("trades")
      .select("decision_id,alpaca_order_id,status")
      .in("decision_id", tradeDecisionIds);
    for (const t of (data ?? []) as {
      decision_id: string;
      alpaca_order_id: string | null;
      status: string | null;
    }[]) {
      const list = byDecision.get(t.decision_id) ?? [];
      list.push({ alpaca_order_id: t.alpaca_order_id, status: t.status });
      byDecision.set(t.decision_id, list);
    }
  }

  return rows.map((r) => ({
    ...r,
    orderOutcome: deriveOrderOutcome(r.action, byDecision.get(r.id) ?? []),
  }));
}

export type DecisionHistoryPage = {
  rows: DecisionRow[];
  total: number;
  page: number;
  pageSize: number;
};

/** Paginated full decision history for the demo-admin backoffice. */
export async function fetchDecisionHistory(opts: {
  page?: number;
  pageSize?: number;
  action?: "trade" | "no_trade";
}): Promise<DecisionHistoryPage> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = opts.pageSize ?? DECISIONS_PAGE_SIZE;
  const from = (page - 1) * pageSize;

  const supabase = await createClient();
  let query = supabase
    .from("decisions")
    .select(DECISION_COLS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (opts.action) query = query.eq("action", opts.action);

  const { data, count } = await query;
  return {
    rows: await attachOrderOutcomes(supabase, (data as DecisionRow[] | null) ?? []),
    total: count ?? 0,
    page,
    pageSize,
  };
}

export type DecisionDetail = {
  decision: DecisionDetailRow | null;
  riskChecks: RiskCheckRow[];
  trades: TradeRow[];
};

/** One decision with its risk-check rows and any orders it produced. */
export async function fetchDecisionDetail(id: string): Promise<DecisionDetail> {
  const supabase = await createClient();
  const [decision, checks, trades] = await Promise.all([
    supabase.rpc("beleth_decision_detail", { p_id: id }).maybeSingle(),
    supabase
      .from("risk_checks")
      .select(
        "id,candidate_index,rule,passed,approved,reason,detail,candidate,max_loss,breakeven",
      )
      .eq("decision_id", id)
      .order("candidate_index", { ascending: true })
      .order("rule", { ascending: true }),
    supabase
      .from("trades")
      .select(
        "id,created_at,underlying,kind,exit_reason,alpaca_order_id,client_order_id,status,qty,filled_qty,filled_avg_price,credit,max_loss,legs",
      )
      .eq("decision_id", id)
      .order("created_at", { ascending: true }),
  ]);

  return {
    decision: (decision.data as DecisionDetailRow | null) ?? null,
    riskChecks: (checks.data as RiskCheckRow[] | null) ?? [],
    trades: (trades.data as TradeRow[] | null) ?? [],
  };
}

/** The strategy-config snapshot from the most recent decision. */
export async function fetchLatestStrategyConfig(): Promise<{
  config: Record<string, unknown> | null;
  asOf: string | null;
  agentVersion: string | null;
  /** VIX 1y percentile from the same decision's evidence package, for the R9 taper marker. */
  vixPercentile: number | null;
}> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("decisions")
    .select("created_at,agent_version,strategy_config,evidence")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = data as
    | {
        created_at: string;
        agent_version: string;
        strategy_config: Record<string, unknown> | null;
        evidence: Record<string, unknown> | null;
      }
    | null;

  const vix = (row?.evidence?.vix ?? null) as Record<string, unknown> | null;
  const pct = vix ? Number(vix.percentile_1y) : NaN;

  return {
    config: row?.strategy_config ?? null,
    asOf: row?.created_at ?? null,
    agentVersion: row?.agent_version ?? null,
    vixPercentile: Number.isFinite(pct) ? pct : null,
  };
}

export type ControlPanel = {
  agentStatus: AgentStatusRow | null;
  hostHistory: HostHistoryPoint[];
  recentEvents: AgentEvent[];
};

const EVENT_COLS =
  "id,created_at,level,event,symbol,message,context,decision_id";

export type EventLogPage = {
  rows: AgentEvent[];
  total: number;
  page: number;
  pageSize: number;
};

/** The backoffice "Logs" tab: filter by event slug and by time window, paged. */
export async function fetchEventLog(opts: {
  page?: number;
  pageSize?: number;
  events?: string[];
  since?: string | null;
}): Promise<EventLogPage> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = opts.pageSize ?? 40;
  const from = (page - 1) * pageSize;

  const supabase = await createClient();
  let query = supabase
    .from("agent_events")
    .select(EVENT_COLS, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (opts.events && opts.events.length > 0) {
    query = query.in("event", opts.events);
  }
  if (opts.since) query = query.gte("created_at", opts.since);

  const { data, count } = await query;
  return {
    rows: (data as AgentEvent[] | null) ?? [],
    total: count ?? 0,
    page,
    pageSize,
  };
}

/**
 * The master-admin control panel: current agent state, the trailing
 * host-telemetry history, and the most recent agent events (kill-switch flips
 * included — they land in `agent_events` now, so there is no separate control
 * history). All three tables are readable by demo_admin and up (0011 / 0012).
 */
export async function fetchControlPanel(): Promise<ControlPanel> {
  const supabase = await createClient();
  const [status, host, recent] = await Promise.all([
    supabase
      .from("agent_status")
      .select(AGENT_STATUS_COLS)
      .eq("id", AGENT_STATUS_ID)
      .maybeSingle(),
    supabase
      .from("host_metrics")
      .select("captured_at,metrics")
      .order("captured_at", { ascending: false })
      .limit(240),
    supabase
      .from("agent_events")
      .select(EVENT_COLS)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  return {
    agentStatus: (status.data as AgentStatusRow | null) ?? null,
    hostHistory: ((host.data as HostHistoryPoint[] | null) ?? []).slice().reverse(),
    recentEvents: (recent.data as AgentEvent[] | null) ?? [],
  };
}

type LegDesc = {
  role?: string;
  right?: string;
  strike?: number | string | null;
};

type TradeJoinRow = {
  id: string;
  created_at: string;
  underlying: string;
  kind: "entry" | "exit";
  exit_reason: string | null;
  client_order_id: string | null;
  decision_id: string | null;
  status: string | null;
  qty: string | null;
  credit: string | null;
  max_loss: string | null;
  legs: LegDesc[] | null;
};

export type PositionsView = {
  open: SpreadPosition[];
  history: SpreadPosition[];
  /** False when the Alpaca read failed — the page then shows only what the
   *  `trades` table knows (pre-submission failures) plus a soft warning. */
  alpacaOk: boolean;
};

/**
 * The backoffice "Positions" view: open spreads (live P&L from Alpaca) plus
 * the history of closed / canceled / failed ones. Alpaca is the lifecycle
 * source (our tables do not keep it); the `trades` table only adds the
 * decision link and the pre-submission failures Alpaca never saw.
 */
export async function fetchPositionsView(): Promise<PositionsView> {
  const supabase = await createClient();

  const [alpaca, tradesRes] = await Promise.all([
    fetchSpreadPositions().then(
      (rows) => ({ rows, ok: true }),
      (err) => {
        console.error("positions: alpaca fetch failed", err);
        return { rows: [] as SpreadPosition[], ok: false };
      },
    ),
    supabase
      .from("trades")
      .select(
        "id,created_at,underlying,kind,exit_reason,client_order_id,decision_id,status,qty,credit,max_loss,legs",
      )
      .order("created_at", { ascending: false }),
  ]);

  const trades = (tradesRes.data as TradeJoinRow[] | null) ?? [];

  const decisionByCoid = new Map<string, string>(); // entry client_order_id -> decision_id
  const exitReasonByCoid = new Map<string, string>(); // exit client_order_id -> R5 rule
  for (const t of trades) {
    if (!t.client_order_id) continue;
    if (t.decision_id) decisionByCoid.set(t.client_order_id, t.decision_id);
    if (t.kind === "exit" && t.exit_reason)
      exitReasonByCoid.set(t.client_order_id, t.exit_reason);
  }

  const enrich = (p: SpreadPosition): SpreadPosition => ({
    ...p,
    decisionId:
      p.decisionId ??
      (p.clientOrderId ? decisionByCoid.get(p.clientOrderId) ?? null : null),
    exitReason:
      p.exitReason ??
      (p.exitClientOrderId
        ? exitReasonByCoid.get(p.exitClientOrderId) ?? null
        : null),
  });

  const open = alpaca.rows.filter((p) => p.state === "open").map(enrich);
  const history = alpaca.rows.filter((p) => p.state !== "open").map(enrich);

  // Orders rejected by our own risk gate never reach Alpaca — pull them from
  // the trades table (they carry no alpaca_order_id).
  for (const t of trades) {
    if (t.status !== "submission_failed") continue;
    const legs = t.legs ?? [];
    const shortLeg = legs.find((l) => l.role === "short") ?? null;
    const longLeg = legs.find((l) => l.role === "long") ?? null;
    const right =
      (shortLeg?.right as "C" | "P" | undefined) ??
      (longLeg?.right as "C" | "P" | undefined) ??
      null;
    const shortStrike =
      shortLeg?.strike != null ? Number(shortLeg.strike) : null;
    const longStrike = longLeg?.strike != null ? Number(longLeg.strike) : null;
    history.push({
      id: `trades:${t.id}`,
      state: "failed",
      underlying: t.underlying,
      right,
      qty: t.qty != null ? Number(t.qty) : null,
      spread: spreadLabel(right, shortStrike, longStrike),
      shortStrike,
      longStrike,
      expiry: null,
      entryCredit: t.credit != null ? Number(t.credit) : null,
      exitDebit: null,
      realizedPnl: null,
      unrealizedPnl: null,
      marketValue: null,
      maxLoss: t.max_loss != null ? Number(t.max_loss) : null,
      openedAt: t.created_at,
      closedAt: t.created_at,
      exitReason: null,
      failureReason: "rejected by risk check before submission",
      alpacaStatus: null,
      clientOrderId: t.client_order_id,
      exitClientOrderId: null,
      decisionId: t.decision_id,
    });
  }

  history.sort((a, b) =>
    (b.closedAt ?? b.openedAt ?? "").localeCompare(
      a.closedAt ?? a.openedAt ?? "",
    ),
  );

  return { open, history, alpacaOk: alpaca.ok };
}

export type MarketCalendarView = {
  /** Open trading days in the requested grid window, keyed by `YYYY-MM-DD`. */
  days: MarketCalendarDay[];
  clock: MarketClock | null;
  /** False when the Alpaca calendar read failed — the page shows a soft note. */
  alpacaOk: boolean;
};

/**
 * The "Calendar" view: the exchange trading calendar for the six-week grid
 * around `year`/`month0`, plus the live market clock for the status strip.
 * Alpaca is the only source; a failure degrades to an empty grid + a note.
 */
export async function fetchMarketCalendarView(
  year: number,
  month0: number,
): Promise<MarketCalendarView> {
  const { start, end } = matrixRange(year, month0);
  const [cal, clock] = await Promise.all([
    fetchMarketCalendar(start, end).then(
      (days) => ({ days, ok: true }),
      (err) => {
        console.error("market calendar: alpaca fetch failed", err);
        return { days: [] as MarketCalendarDay[], ok: false };
      },
    ),
    fetchMarketClock().catch((err) => {
      console.error("market calendar: clock fetch failed", err);
      return null;
    }),
  ]);
  return { days: cal.days, clock, alpacaOk: cal.ok };
}

export type TradeCalendarData = {
  /** Every day with at least one closed round-trip, ascending by date. */
  days: TradeCalendarDay[];
  /** `YYYY-MM-DD` of the earliest / latest closed trade, for month nav bounds. */
  firstDate: string | null;
  lastDate: string | null;
  alpacaOk: boolean;
};

/**
 * Daily roll-up of closed spreads (count + realised P&L) for the trade
 * calendar. Reuses the same Alpaca round-trip reconstruction as the Positions
 * view; each closed spread counts once, on its exit-fill date in US/Eastern.
 * Pre-submission and canceled orders are not trades and are excluded.
 */
export async function fetchTradeCalendar(): Promise<TradeCalendarData> {
  let ok = true;
  let rows: SpreadPosition[] = [];
  try {
    rows = await fetchSpreadPositions();
  } catch (err) {
    console.error("trade calendar: alpaca fetch failed", err);
    ok = false;
  }

  const byDate = new Map<string, { trades: number; realizedPnl: number }>();
  for (const p of rows) {
    if (p.state !== "closed") continue;
    const stamp = p.closedAt ?? p.openedAt;
    if (!stamp) continue;
    const key = nyDateKey(stamp);
    const cur = byDate.get(key) ?? { trades: 0, realizedPnl: 0 };
    cur.trades += 1;
    cur.realizedPnl += p.realizedPnl ?? 0;
    byDate.set(key, cur);
  }

  const days: TradeCalendarDay[] = [...byDate.entries()]
    .map(([date, v]) => ({ date, ...v }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    days,
    firstDate: days[0]?.date ?? null,
    lastDate: days[days.length - 1]?.date ?? null,
    alpacaOk: ok,
  };
}

/**
 * Number of currently open spreads, for the sidebar badge. Each credit spread
 * has exactly one short leg, so counting `positions` rows with `side='short'`
 * gives the spread count without pairing. Cheap enough for the dashboard
 * layout; returns 0 if the read fails so the badge just disappears.
 */
export async function fetchOpenSpreadCount(): Promise<number> {
  try {
    const supabase = await createClient();
    const { count } = await supabase
      .from("positions")
      .select("symbol", { count: "exact", head: true })
      .eq("side", "short");
    return count ?? 0;
  } catch (err) {
    console.error("positions: open-count fetch failed", err);
    return 0;
  }
}

// --- Portfolio -------------------------------------------------------------

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
}

function numberList(v: unknown): number[] {
  return Array.isArray(v)
    ? v.filter((n): n is number => typeof n === "number" && Number.isFinite(n))
    : [];
}

/**
 * The backoffice "Portfolio" view: the underlyings Beleth trades now (from the
 * live strategy config) and the documented next candidates, each joined to its
 * Alpaca quote and to Beleth's own record on that name (open spreads, realized
 * P&L, decision cycles). Alpaca failures degrade to a config-only render.
 */
export async function fetchPortfolioView(): Promise<PortfolioView> {
  const supabase = await createClient();

  const { config, asOf } = await fetchLatestStrategyConfig();
  const cfg = (config ?? {}) as Record<string, unknown>;
  const universe = (cfg.universe ?? {}) as Record<string, unknown>;
  const structure = (cfg.structure ?? {}) as Record<string, unknown>;
  const tenor = (cfg.tenor_scan ?? {}) as Record<string, unknown>;

  const configured = stringList(universe.symbols).map((s) => s.toUpperCase());
  const liveSymbols = configured.length > 0 ? configured : DEFAULT_LIVE_SYMBOLS;

  const dMin = numOrNull(structure.short_leg_delta_min);
  const dMax = numOrNull(structure.short_leg_delta_max);
  const wMin = numOrNull(structure.strike_width_usd_min);
  const wMax = numOrNull(structure.strike_width_usd_max);
  const ladder = numberList(tenor.dte_ladder);

  const params = {
    deltaBand: dMin != null && dMax != null ? `${dMin} to ${dMax}` : null,
    strikeWidth: wMin != null && wMax != null ? `$${wMin} to $${wMax}` : null,
    dteLadder: ladder.length > 0 ? ladder.join(" / ") : null,
  };

  const watchSymbols = INSTRUMENTS.map((i) => i.symbol).filter(
    (s) => !liveSymbols.includes(s),
  );
  const allSymbols = [...liveSymbols, ...watchSymbols];

  const [snapRes, posRes, decRes] = await Promise.all([
    fetchStockSnapshots(allSymbols).then(
      (rows) => ({ rows, ok: true }),
      (err) => {
        console.error("portfolio: alpaca snapshots failed", err);
        return { rows: {} as Record<string, InstrumentQuote>, ok: false };
      },
    ),
    fetchSpreadPositions().then(
      (rows) => ({ rows, ok: true }),
      (err) => {
        console.error("portfolio: alpaca positions failed", err);
        return { rows: [] as SpreadPosition[], ok: false };
      },
    ),
    supabase
      .from("decisions")
      .select("symbol,action,created_at")
      .order("created_at", { ascending: false })
      .limit(6000),
  ]);

  const statsBySymbol = new Map<string, InstrumentStats>();
  const statFor = (sym: string): InstrumentStats => {
    let s = statsBySymbol.get(sym);
    if (!s) {
      s = { ...EMPTY_STATS };
      statsBySymbol.set(sym, s);
    }
    return s;
  };

  for (const p of posRes.rows) {
    const s = statFor(p.underlying.toUpperCase());
    if (p.state === "open") {
      s.openSpreads += 1;
      if (p.unrealizedPnl != null)
        s.unrealizedPnl = (s.unrealizedPnl ?? 0) + p.unrealizedPnl;
    } else if (p.state === "closed") {
      s.closed += 1;
      if (p.realizedPnl != null) {
        s.realizedPnl = (s.realizedPnl ?? 0) + p.realizedPnl;
        if (p.realizedPnl > 0) s.wins += 1;
      }
    } else if (p.state === "canceled") {
      s.canceled += 1;
    } else if (p.state === "failed") {
      s.failed += 1;
    }
  }

  const decisions =
    (decRes.data as
      | { symbol: string | null; action: string | null; created_at: string }[]
      | null) ?? [];
  for (const d of decisions) {
    if (!d.symbol) continue;
    const s = statFor(d.symbol.toUpperCase());
    s.cycles += 1;
    if (s.lastSeen == null) {
      s.lastSeen = d.created_at;
      s.lastAction =
        d.action === "trade"
          ? "trade"
          : d.action === "no_trade"
            ? "no_trade"
            : null;
    }
  }

  const metaFor = (sym: string): InstrumentMeta =>
    INSTRUMENT_BY_SYMBOL[sym] ?? {
      symbol: sym,
      name: sym,
      tracks: "",
      exchange: "",
      assetClass: "ETF",
      tvSymbol: sym,
      note: "",
    };

  const build = (
    sym: string,
    status: PortfolioInstrument["status"],
  ): PortfolioInstrument => ({
    ...metaFor(sym),
    status,
    quote: snapRes.rows[sym] ?? null,
    stats: statsBySymbol.get(sym) ?? { ...EMPTY_STATS },
  });

  return {
    live: liveSymbols.map((s) => build(s, "live")),
    watch: watchSymbols.map((s) => build(s, "watch")),
    params,
    asOf,
    alpacaOk: snapRes.ok && posRes.ok,
  };
}
