/**
 * Client-safe types + metadata for the `agent_events` log (migration 0012).
 *
 * The agent writes a curated line per meaningful thing that happens (a decision,
 * a submitted or failed order, a risk rejection, an exit trigger, a pause, an
 * error). The backoffice "Logs" tab reads and filters them. No `server-only`
 * import here so a Client Component can use the shapes.
 */

export type EventLevel = "debug" | "info" | "warn" | "error";

export type AgentEvent = {
  id: number;
  created_at: string;
  level: EventLevel;
  event: string;
  symbol: string | null;
  message: string;
  context: Record<string, unknown>;
  decision_id: string | null;
};

/** Known event slugs → display label. Unknown slugs fall back to a de-slugged form. */
export const EVENT_META: Record<string, { label: string }> = {
  runner_start: { label: "Runner start" },
  runner_stop: { label: "Runner stop" },
  clock_unavailable: { label: "Clock unavailable" },
  switch_unreadable: { label: "Switch unreadable" },
  paused: { label: "Paused" },
  resumed: { label: "Resumed" },
  decision: { label: "Decision" },
  no_trade: { label: "No-trade" },
  risk_rejected: { label: "Risk rejected" },
  order_submitted: { label: "Order submitted" },
  order_failed: { label: "Order failed" },
  exit_triggered: { label: "Exit triggered" },
  exit_submitted: { label: "Exit submitted" },
  exit_failed: { label: "Exit failed" },
  position_anomaly: { label: "Position anomaly" },
  error: { label: "Error" },
};

/** Filter chips, in display order — the slugs the agent actually emits. */
export const EVENT_FILTER_SLUGS: string[] = Object.keys(EVENT_META);

export function eventLabel(slug: string): string {
  return EVENT_META[slug]?.label ?? slug.replace(/_/g, " ");
}

export const RANGE_PRESETS = [
  { key: "1d", label: "24h", hours: 24 },
  { key: "3d", label: "3d", hours: 72 },
  { key: "7d", label: "7d", hours: 168 },
  { key: "30d", label: "30d", hours: 720 },
  { key: "all", label: "All", hours: null },
] as const;

export type RangeKey = (typeof RANGE_PRESETS)[number]["key"];

export const DEFAULT_RANGE: RangeKey = "7d";

/** ISO cutoff for a preset key, or null for "all". Plain fn → safe to call in render. */
export function rangeSince(key: string): string | null {
  const p = RANGE_PRESETS.find((r) => r.key === key);
  if (!p || p.hours == null) return null;
  return new Date(Date.now() - p.hours * 3_600_000).toISOString();
}
