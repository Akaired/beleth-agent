/**
 * The read-only tool layer for "Chat with Beleth".
 *
 * Every executor here does one thing: SELECT. Nothing in this file writes to
 * Supabase, calls a trading endpoint, or mutates state — that is the contract
 * that lets Beleth answer questions in the chat without being able to act.
 * Supabase reads go through the caller's authenticated SSR client (RLS
 * applies); Alpaca reads reuse the server-only helpers in `src/lib/alpaca.ts`.
 */
import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { fetchAccountSnapshot, fetchSpreadPositions } from "@/lib/alpaca";
import { METHODOLOGY_TEXT } from "@/lib/chat/methodology";

type SupabaseSSR = Awaited<ReturnType<typeof createClient>>;

export type ToolContext = { supabase: SupabaseSSR };

export type ToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

type ToolDef = {
  schema: ToolSchema;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
};

const clampLimit = (v: unknown, def: number, max: number): number => {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
};

type EvidenceLike = {
  as_of?: unknown;
  market_open?: unknown;
  underlying?: { symbol?: unknown; last?: unknown; realized_vol?: unknown };
  vix?: {
    level?: unknown;
    percentile_1y?: unknown;
    rank_1y?: unknown;
    term_structure?: unknown;
    short_atm_iv?: unknown;
    long_atm_iv?: unknown;
  };
  vrp?: { vix_minus_rv20?: unknown; per_tenor?: unknown };
  calendar?: { next_macro_event?: unknown; blocks_tenors?: unknown };
  candidates?: Array<Record<string, unknown>>;
  account?: unknown;
};

/** Trim the evidence package to the fields Beleth reasons about in chat. */
function slimEvidence(ev: Record<string, unknown> | null): unknown {
  if (!ev) return null;
  const e = ev as EvidenceLike;
  return {
    as_of: e.as_of ?? null,
    market_open: e.market_open ?? null,
    underlying: {
      symbol: e.underlying?.symbol ?? null,
      last: e.underlying?.last ?? null,
      realized_vol: e.underlying?.realized_vol ?? null,
    },
    vix: {
      level: e.vix?.level ?? null,
      percentile_1y: e.vix?.percentile_1y ?? null,
      rank_1y: e.vix?.rank_1y ?? null,
      term_structure: e.vix?.term_structure ?? null,
      short_atm_iv: e.vix?.short_atm_iv ?? null,
      long_atm_iv: e.vix?.long_atm_iv ?? null,
    },
    vrp: {
      vix_minus_rv20: e.vrp?.vix_minus_rv20 ?? null,
      per_tenor: e.vrp?.per_tenor ?? [],
    },
    calendar: {
      next_macro_event: e.calendar?.next_macro_event ?? null,
      blocks_tenors: e.calendar?.blocks_tenors ?? [],
    },
    candidates: (e.candidates ?? []).map((c: Record<string, unknown>) => ({
      expiry: c.expiry ?? null,
      dte: c.dte ?? null,
      strikes: c.strikes ?? null,
      delta_short: c.delta_short ?? null,
      credit: c.credit ?? null,
      max_loss: c.max_loss ?? null,
      breakeven: c.breakeven ?? null,
    })),
    account: e.account ?? null,
  };
}

const TOOLS: ToolDef[] = [
  {
    schema: {
      type: "function",
      function: {
        name: "get_agent_status",
        description:
          "Beleth's current run state: whether the agent is monitoring, evaluating, in a drawdown or paused (the operator kill switch), when the last cycle ran, and a one-line summary of the latest decision.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    async run(_args, { supabase }) {
      const [status, latest] = await Promise.all([
        supabase
          .from("agent_status")
          .select("state,paused,last_cycle_at")
          .eq("id", 1)
          .maybeSingle(),
        supabase
          .from("decisions")
          .select("created_at,action,symbol,summary")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      return {
        state: status.data?.state ?? "unknown",
        paused: status.data?.paused ?? false,
        last_cycle_at: status.data?.last_cycle_at ?? null,
        latest_decision: latest.data ?? null,
      };
    },
  },
  {
    schema: {
      type: "function",
      function: {
        name: "get_latest_decision",
        description:
          "The most recent decision in full: action (trade / no_trade), plain-language summary, the equity and day P&L at the time, and the evidence package that produced it (VIX regime, per-tenor VRP, term structure, macro-event gate, candidate spreads and their max loss).",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    async run(_args, { supabase }) {
      const { data } = await supabase
        .from("decisions")
        .select(
          "id,created_at,symbol,action,summary,market_open,equity,day_pnl,decision_source,llm_model,evidence",
        )
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) return { error: "no decisions recorded yet" };
      return { ...data, evidence: slimEvidence(data.evidence) };
    },
  },
  {
    schema: {
      type: "function",
      function: {
        name: "list_recent_decisions",
        description:
          "A compact list of recent decisions (newest first): timestamp, action, symbol, day P&L, and the one-line summary. Use to talk about what Beleth has been doing lately.",
        parameters: {
          type: "object",
          properties: {
            limit: {
              type: "integer",
              description: "How many to return (1-20, default 8).",
            },
          },
          additionalProperties: false,
        },
      },
    },
    async run(args, { supabase }) {
      const limit = clampLimit(args.limit, 8, 20);
      const { data } = await supabase
        .from("decisions")
        .select("created_at,action,symbol,summary,day_pnl,equity")
        .order("created_at", { ascending: false })
        .limit(limit);
      return data ?? [];
    },
  },
  {
    schema: {
      type: "function",
      function: {
        name: "get_risk_rejections",
        description:
          "Recent candidate trades that Beleth's own pre-trade risk gate REFUSED (newest first): the rule that fired (R4/R6/R7/R9/R10/R11...), the human-readable reason with its numbers, and the candidate. The refusals are a transparency feature — quote them freely.",
        parameters: {
          type: "object",
          properties: {
            limit: {
              type: "integer",
              description: "How many to return (1-20, default 10).",
            },
          },
          additionalProperties: false,
        },
      },
    },
    async run(args, { supabase }) {
      const limit = clampLimit(args.limit, 10, 20);
      const { data } = await supabase
        .from("risk_checks")
        .select("created_at,rule,reason,passed,approved,candidate,max_loss")
        .eq("approved", false)
        .neq("rule", "R5")
        .order("created_at", { ascending: false })
        .limit(limit);
      return data ?? [];
    },
  },
  {
    schema: {
      type: "function",
      function: {
        name: "get_strategy_config",
        description:
          "The strategy parameters in force at the latest decision (a snapshot of config/strategy.yaml): the VRP threshold and DTE ladder, the short-leg delta band and strike widths, the exit targets, the sizing caps, and the VIX-regime size taper.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    async run(_args, { supabase }) {
      const { data } = await supabase
        .from("decisions")
        .select("created_at,agent_version,strategy_config")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data?.strategy_config) return { error: "no strategy snapshot available" };
      return {
        as_of: data.created_at,
        agent_version: data.agent_version,
        config: data.strategy_config,
      };
    },
  },
  {
    schema: {
      type: "function",
      function: {
        name: "get_account_summary",
        description:
          "Live paper-account balances from Alpaca: current equity, previous close equity, day P&L (absolute and percent).",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    async run() {
      try {
        const s = await fetchAccountSnapshot();
        return {
          equity: s.equity,
          last_equity: s.lastEquity,
          day_pnl: s.dayPnl,
          day_pnl_pct: s.dayPnlPct,
          as_of: s.asOf,
        };
      } catch (err) {
        return { error: `Alpaca account read failed: ${(err as Error).message}` };
      }
    },
  },
  {
    schema: {
      type: "function",
      function: {
        name: "get_open_positions",
        description:
          "The spreads currently open on the paper account, reconstructed from Alpaca: underlying, put/call, short and long strikes, quantity, entry credit, live unrealized P&L, defined max loss, and expiry.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    async run() {
      try {
        const all = await fetchSpreadPositions();
        return all
          .filter((p) => p.state === "open")
          .map((p) => ({
            underlying: p.underlying,
            right: p.right,
            spread: p.spread,
            short_strike: p.shortStrike,
            long_strike: p.longStrike,
            qty: p.qty,
            entry_credit: p.entryCredit,
            unrealized_pnl: p.unrealizedPnl,
            max_loss: p.maxLoss,
            expiry: p.expiry,
            opened_at: p.openedAt,
          }));
      } catch (err) {
        return { error: `Alpaca positions read failed: ${(err as Error).message}` };
      }
    },
  },
  {
    schema: {
      type: "function",
      function: {
        name: "get_methodology",
        description:
          "The full strategy notes text, organised by reliability tier (Level A research, Level B convention, Level C our choices) plus the operating rules R1-R11 and their sources. Call this when asked to justify or cite the strategy.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    async run() {
      return { strategy: METHODOLOGY_TEXT };
    },
  },
];

const BY_NAME = new Map(TOOLS.map((t) => [t.schema.function.name, t]));

export const TOOL_SCHEMAS: ToolSchema[] = TOOLS.map((t) => t.schema);

/** Execute one tool call. Never throws — returns `{ error }` on failure. */
export async function runTool(
  name: string,
  rawArgs: string,
  ctx: ToolContext,
): Promise<unknown> {
  const tool = BY_NAME.get(name);
  if (!tool) return { error: `unknown tool: ${name}` };
  let args: Record<string, unknown> = {};
  if (rawArgs && rawArgs.trim()) {
    try {
      args = JSON.parse(rawArgs) as Record<string, unknown>;
    } catch {
      return { error: `could not parse arguments for ${name}` };
    }
  }
  try {
    return await tool.run(args, ctx);
  } catch (err) {
    return { error: `${name} failed: ${(err as Error).message}` };
  }
}
