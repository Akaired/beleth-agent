"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export type ControlActionResult =
  | { ok: true; paused: boolean }
  | { ok: false; error: string };

/**
 * Flip the agent kill switch (`agent_status.paused`). Two guards: this action
 * refuses a non-master_admin caller, and the `beleth_set_agent_paused` RPC it
 * calls checks `beleth_role()` again in the database and touches nothing but
 * that one column. The RPC also appends the change to `agent_control_events`.
 */
export async function setAgentPausedAction(
  paused: boolean,
): Promise<ControlActionResult> {
  const ctx = await getSessionContext();
  if (!ctx || ctx.role !== "master_admin") {
    return { ok: false, error: "Not authorized." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("beleth_set_agent_paused", {
    p_paused: paused,
  });
  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath("/dashboard/controls");
  revalidatePath("/dashboard");
  return { ok: true, paused };
}
