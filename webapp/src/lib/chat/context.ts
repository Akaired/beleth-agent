/**
 * The live "mood" for a chat: the same signals the homepage mascot reads
 * (latest decision + agent status), reused so Beleth's tone in the chat tracks
 * its P&L, and the sprite in the chat header shows the right scene.
 */
import "server-only";
import { createClient } from "@/lib/supabase/server";
import { belethPnl, belethScene, type BelethScene } from "@/lib/beleth";
import type { AgentStatusRow, DecisionRow } from "@/lib/queries";
import { AGENT_STATUS_COLS, AGENT_STATUS_ID } from "@/lib/schema";

const DECISION_COLS =
  "id,created_at,as_of,symbol,action,summary,market_open,equity,day_pnl,decision_source,llm_model,evidence";

export async function fetchBelethChatContext(): Promise<{
  mood: "up" | "down" | null;
  scene: BelethScene;
}> {
  try {
    const supabase = await createClient();
    const [statusRes, decisionRes] = await Promise.all([
      supabase
        .from("agent_status")
        .select(AGENT_STATUS_COLS)
        .eq("id", AGENT_STATUS_ID)
        .maybeSingle(),
      supabase
        .from("decisions")
        .select(DECISION_COLS)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    const status = (statusRes.data as AgentStatusRow | null) ?? null;
    const decision = (decisionRes.data as DecisionRow | null) ?? null;
    return {
      mood: belethPnl(decision),
      scene: belethScene({ status, decision, clock: null }),
    };
  } catch {
    return { mood: null, scene: "guard" };
  }
}
