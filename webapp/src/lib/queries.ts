/**
 * Typed reads behind the public homepage. Every query maps 1:1 onto the
 * tables the agent persists (db/migrations/0001_initial_schema.sql) and the
 * dashboard queries documented in db/README.md.
 */
import { DataUnavailableError, restCount, restGet } from "@/lib/supabase";

export type DecisionRow = {
  id: string;
  created_at: string;
  as_of: string;
  symbol: string;
  action: "trade" | "no_trade";
  summary: string;
  market_open: boolean;
  equity: string;
  day_pnl: string;
  decision_source: "risk_engine" | "llm";
  llm_model: string | null;
  evidence: EvidencePackage | null;
};

/** Shape produced by app/evidence.py build_evidence_package (subset we read). */
export type EvidencePackage = {
  as_of?: string;
  market_open?: boolean;
  underlying?: { symbol?: string; last?: number | null; realized_vol?: Record<string, number | null> };
  vix?: {
    level?: number | null;
    percentile_1y?: number | null;
    rank_1y?: number | null;
    error?: string;
    term_structure?: string;
    short_atm_iv?: number | null;
  };
  vrp?: {
    vix_minus_rv20?: number | null;
    per_tenor?: Array<{
      dte: number;
      atm_iv: number | null;
      vrp_vs_rv20: number | null;
      passes_threshold: boolean;
    }>;
  };
  calendar?: {
    next_macro_event?: { name: string; days_away: number } | null;
    blocks_tenors?: number[];
  };
  candidates?: Array<{ max_loss?: number | null; credit?: number | null }>;
  account?: { day_pnl?: number | null; open_positions?: number | null };
};

export type AgentStatusRow = {
  state: string;
  paused: boolean;
  last_cycle_at: string;
  detail: Record<string, unknown>;
};


export type HomepageData = {
  latestDecision: DecisionRow | null;
  cyclesRun: number;
  tradesSubmitted: number;
  refused: number;
  openPositions: number;
  firstDecisionAt: string | null;
  agentStatus: AgentStatusRow | null;
};

/**
 * One page render = five small queries against the anon-key read path.
 * The homepage sets `revalidate = 60`, so these run at most once a minute.
 */
export async function fetchHomepageData(): Promise<HomepageData> {
  const [latest, counts, first, agentStatus, openPositions] = await Promise.all([
    restGet<DecisionRow>("decisions", {
      select:
        "id,created_at,as_of,symbol,action,summary,market_open,equity,day_pnl,decision_source,llm_model,evidence",
      order: "created_at.desc",
      limit: "1",
    }),
    Promise.all([
      restCount("decisions"),
      // The agent never updates a trade row after submission (no fill-status
      // sync loop exists yet — positions.qty is the live source for what's
      // actually open), so "status=filled" would always read 0. Count orders
      // that reached Alpaca instead: they carry an alpaca_order_id, which a
      // submission_failed row never gets.
      restCount("trades", { kind: "eq.entry", alpaca_order_id: "not.is.null" }),
      fetchRefusedCount(),
    ]),
    restGet<{ created_at: string }>("decisions", {
      select: "created_at",
      order: "created_at.asc",
      limit: "1",
    }),
    restGet<AgentStatusRow>("agent_status", {
      select: "state,paused,last_cycle_at,detail",
      id: "eq.1",
      limit: "1",
    }).catch(() => [] as AgentStatusRow[]),
    // Open spreads = short-side legs in `positions`, the same definition the
    // dashboard's open-count badge uses. Anon-readable via 0003.
    restCount("positions", { side: "eq.short" }).catch(() => 0),
  ]);

  return {
    latestDecision: latest[0] ?? null,
    cyclesRun: counts[0],
    tradesSubmitted: counts[1],
    refused: counts[2],
    openPositions,
    firstDecisionAt: first[0]?.created_at ?? null,
    agentStatus: agentStatus[0] ?? null,
  };
}

/**
 * "Refused by risk checks" = blocked candidate verdicts, not rule rows.
 * risk_checks carries one row per (decision, candidate, rule) with the
 * verdict-level `approved` denormalized on each, so counting rows would
 * multiply by ~3. We dedupe (decision_id, candidate_index) pairs, and skip
 * rule='R5' rows — those are exit checks demanding a close, not entry refusals.
 */
async function fetchRefusedCount(): Promise<number> {
  const rows = await restGet<{ decision_id: string; candidate_index: number }>(
    "risk_checks",
    {
      select: "decision_id,candidate_index",
      approved: "eq.false",
      rule: "neq.R5",
    },
  );
  return new Set(rows.map((r) => `${r.decision_id}:${r.candidate_index}`)).size;
}

/** Days since the first persisted decision (min 1 once any data exists). */
export function daysLive(firstDecisionAt: string | null): number {
  if (!firstDecisionAt) return 0;
  const ms = Date.now() - new Date(firstDecisionAt).getTime();
  return Math.max(1, Math.floor(ms / 86_400_000));
}

export type ThoughtBubble = {
  label: string;
  value: string;
  tone: "txt" | "acc" | "up" | "down";
  position: { top: string; side: "left" | "right"; offset: string };
  delay: string;
};

const BUBBLE_SLOTS: Array<ThoughtBubble["position"]> = [
  { top: "2%", side: "left", offset: "-12%" },
  { top: "15%", side: "right", offset: "-14%" },
  { top: "33%", side: "left", offset: "-16%" },
  { top: "47%", side: "right", offset: "-12%" },
  { top: "68%", side: "left", offset: "-10%" },
  { top: "84%", side: "right", offset: "-8%" },
];

const BUBBLE_DELAYS = ["0s", "2.1s", "4.2s", "6.3s", "8.4s", "10.5s"];

function bubble(
  label: string,
  value: string,
  tone: ThoughtBubble["tone"],
  slot: number,
): ThoughtBubble {
  return {
    label,
    value,
    tone,
    position: BUBBLE_SLOTS[slot % BUBBLE_SLOTS.length],
    delay: BUBBLE_DELAYS[slot % BUBBLE_DELAYS.length],
  };
}

function fmt(v: number | null | undefined, digits = 2, suffix = ""): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "n/a";
  return `${v.toFixed(digits)}${suffix}`;
}

/**
 * The mascot "thinks" the agent's actual numbers, one at a time — the same
 * narrative arc as the mockup (price → realized vol → priced IV → verdict →
 * event gate → worst case), populated from the latest decision's evidence
 * package. Honest static fallbacks when fields are missing.
 */
export function thoughtBubbles(decision: DecisionRow | null): ThoughtBubble[] {
  const ev = decision?.evidence ?? null;
  if (!ev) {
    return [
      bubble("reading the market", "first cycle soon", "txt", 0),
      bubble("rule", "refuse unless clear", "acc", 2),
      bubble("every decision", "published", "up", 4),
    ];
  }
  const out: ThoughtBubble[] = [];
  const sym = ev.underlying?.symbol ?? decision?.symbol ?? "SPY";
  const last = ev.underlying?.last;
  if (last !== null && last !== undefined) {
    out.push(bubble(sym, last.toFixed(2), "txt", 0));
  }
  const rv20 = ev.underlying?.realized_vol?.["20d"];
  if (rv20 !== null && rv20 !== undefined) {
    out.push(bubble("moving lately", fmt(rv20 * 100, 1, "%"), "txt", 1));
  }
  const best = (ev.vrp?.per_tenor ?? [])
    .filter((t) => t.passes_threshold)
    .sort((a, b) => (b.vrp_vs_rv20 ?? -1) - (a.vrp_vs_rv20 ?? -1))[0];
  if (best) {
    out.push(
      bubble(
        `${best.dte}d priced at`,
        fmt(best.atm_iv, 1, "%"),
        "acc",
        2,
      ),
      bubble(`${best.dte} days`, "worth it", "up", 3),
    );
  } else {
    out.push(bubble("premium vs bar", "below bar", "down", 2));
  }
  const blocked = ev.calendar?.blocks_tenors ?? [];
  if (blocked.length > 0) {
    out.push(bubble("news in the way", `skip ${blocked.join("d, ")}d`, "down", 4));
  }
  const worstCase = (ev.candidates ?? []).reduce<number | null>(
    (acc, c) =>
      c.max_loss != null && (acc === null || c.max_loss > acc) ? c.max_loss : acc,
    null,
  );
  if (worstCase !== null) {
    out.push(bubble("worst case", `$${worstCase.toFixed(0)}`, "txt", 5));
  }
  return out.slice(0, 6);
}

/** Short state line for the header chip. */
export function agentStateLine(
  status: AgentStatusRow | null,
): { label: string; tone: "up" | "acc" | "down" | "dim" } | null {
  if (!status) return null;
  if (status.paused) return { label: "PAUSED", tone: "down" };
  const tone: "up" | "acc" | "down" | "dim" =
    status.state === "trade_executed"
      ? "up"
      : status.state === "risk_check_rejected" || status.state === "drawdown"
        ? "down"
        : status.state === "monitoring" || status.state === "evaluating"
          ? "acc"
          : "dim";
  return { label: status.state.replace(/_/g, " ").toUpperCase(), tone };
}

export { DataUnavailableError };