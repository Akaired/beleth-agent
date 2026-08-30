/**
 * Client-safe types + formatting for the backoffice "Host" panel.
 *
 * The resident runner is a container on a a private host in someone's home. Every
 * heartbeat/cycle the agent folds a machine snapshot into
 * `agent_status.detail.host` (app/hostinfo.py); a 48 h trail of the same shape is
 * appended to the `host_metrics` table for the sparklines. This module only
 * describes and formats that shape — no `server-only` import, so a Client
 * Component can use it.
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

/** Pull the host block out of `agent_status.detail`, tolerating an absent/old shape. */
export function parseHostMetrics(
  detail: Record<string, unknown> | null | undefined,
): HostMetrics | null {
  const host = detail?.["host"];
  if (!host || typeof host !== "object") return null;
  return host as HostMetrics;
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
