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
import type {
  AgentStatusRow,
  DecisionRow,
  EvidencePackage,
} from "@/lib/queries";

export type { AgentStatusRow, DecisionRow, EvidencePackage };

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

export type EquityPoint = { created_at: string; equity: number; day_pnl: number };

export type DashboardOverview = {
  latestDecision: DecisionRow | null;
  agentStatus: AgentStatusRow | null;
  recentDecisions: DecisionRow[];
  equitySeries: EquityPoint[];
  cyclesRun: number;
  tradesSubmitted: number;
  refused: number;
  firstDecisionAt: string | null;
  openPositions: number;
};

const DECISION_COLS =
  "id,created_at,as_of,symbol,action,summary,market_open,equity,day_pnl,decision_source,llm_model,evidence";

const DETAIL_COLS =
  DECISION_COLS + ",agent_version,llm_reasoning,llm_usage,strategy_config";

/** Everything the public-user dashboard needs, in one batch. */
export async function fetchDashboardOverview(): Promise<DashboardOverview> {
  const supabase = await createClient();

  const [
    latest,
    recent,
    series,
    first,
    status,
    cycles,
    trades,
    refusedRows,
    positions,
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
    supabase
      .from("decisions")
      .select("created_at,equity,day_pnl")
      .order("created_at", { ascending: true })
      .limit(500),
    supabase
      .from("decisions")
      .select("created_at")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("agent_status")
      .select("state,paused,last_cycle_at,detail")
      .eq("id", 1)
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
    supabase.from("positions").select("symbol", { count: "exact", head: true }),
  ]);

  const refused = new Set(
    (refusedRows.data ?? []).map(
      (r) => `${r.decision_id}:${r.candidate_index}`,
    ),
  ).size;

  return {
    latestDecision: (latest.data as DecisionRow | null) ?? null,
    agentStatus: (status.data as AgentStatusRow | null) ?? null,
    recentDecisions: (recent.data as DecisionRow[] | null) ?? [],
    equitySeries: ((series.data as Array<{
      created_at: string;
      equity: string;
      day_pnl: string;
    }> | null) ?? []).map((r) => ({
      created_at: r.created_at,
      equity: Number(r.equity),
      day_pnl: Number(r.day_pnl),
    })),
    cyclesRun: cycles.count ?? 0,
    tradesSubmitted: trades.count ?? 0,
    refused,
    firstDecisionAt:
      (first.data as { created_at: string } | null)?.created_at ?? null,
    openPositions: positions.count ?? 0,
  };
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
  const pageSize = opts.pageSize ?? 50;
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
    rows: (data as DecisionRow[] | null) ?? [],
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
    supabase.from("decisions").select(DETAIL_COLS).eq("id", id).maybeSingle(),
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
}> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("decisions")
    .select("created_at,agent_version,strategy_config")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const row = data as
    | {
        created_at: string;
        agent_version: string;
        strategy_config: Record<string, unknown> | null;
      }
    | null;
  return {
    config: row?.strategy_config ?? null,
    asOf: row?.created_at ?? null,
    agentVersion: row?.agent_version ?? null,
  };
}
