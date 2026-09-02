/**
 * Client-safe types + formatting for the backoffice "Host" panel.
 *
 * The resident runner is a container on a private host. Every loop iteration the
 * agent appends a machine snapshot (app/hostinfo.py) to the `host_metrics` table:
 * the newest row is the live value, the rest is the 48 h trail the sparklines read.
 * The table is master_admin only (0033) — the snapshot names the machine.
 * It is deliberately not folded into `agent_status.detail` any more — that row is
 * readable anonymously, and the snapshot names the machine and its kernel.
 * This module only describes and formats that shape — no `server-only` import, so a
 * Client Component can use it.
 */

export type HostMetrics = {
  label: string;
  captured_at: string;
  platform: {
    system?: string;
    release?: string;
    machine?: string;
    node?: string;
    python?: string;
  } | null;
  uptime_seconds: number | null;
  /** 1 / 5 / 15-minute load average. */
  load: [number, number, number] | null;
  cpu_count: number | null;
  /** Host RAM. */
  mem: { total_mb: number; available_mb: number; used_pct: number } | null;
  /** This container's cgroup usage against the compose memory cap. */
  container_mem: {
    used_mb: number;
    limit_mb?: number;
    used_pct?: number;
  } | null;
  disk: { total_gb: number; free_gb: number; used_pct: number } | null;
  logs_disk: { total_gb: number; free_gb: number; used_pct: number } | null;
  /** Warmest thermal zone in °C, or null on hardware that has none. */
  thermal_c: number | null;
  process: {
    rss_mb?: number;
    git_sha?: string;
    started_at?: string;
    cycles?: number;
    last_symbol?: string | null;
  } | null;
  net?: { supabase_ms?: number; alpaca_ms?: number } | null;
};

export type HostHistoryPoint = { captured_at: string; metrics: HostMetrics };

/**
 * The live snapshot: the newest point of an ascending history, tolerating an empty
 * table or an older row shape.
 */
export function latestHostMetrics(
  history: readonly HostHistoryPoint[] | null | undefined,
): HostMetrics | null {
  const newest = history?.[history.length - 1];
  const metrics = newest?.metrics;
  if (!metrics || typeof metrics !== "object") return null;
  return { ...metrics, captured_at: metrics.captured_at ?? newest.captured_at };
}

export function formatUptime(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatGb(gb: number | null | undefined): string {
  if (gb == null) return "—";
  return gb >= 100 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}

export function formatMb(mb: number | null | undefined): string {
  if (mb == null) return "—";
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${Math.round(mb)} MB`;
}

/** Two heartbeats' grace (2× the 15-min closed-market heartbeat). */
export const HOST_STALE_MS = 32 * 60 * 1000;

/** True when the reading is older than `thresholdMs`. Isolated here so components
 * that call it stay pure (the lint rule forbids `Date.now()` in a render body). */
export function isStale(
  iso: string | null | undefined,
  thresholdMs: number = HOST_STALE_MS,
): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() > thresholdMs;
}

/** A used-percentage's tone: calm under 70, amber to 90, red past it. */
export function usageTone(pct: number | null | undefined): "ok" | "warn" | "crit" {
  if (pct == null) return "ok";
  if (pct >= 90) return "crit";
  if (pct >= 70) return "warn";
  return "ok";
}
