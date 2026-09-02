import type { ComponentType } from "react";
import {
  formatGb,
  formatMb,
  formatUptime,
  isStale,
  latestHostMetrics,
  usageTone,
  type HostHistoryPoint,
  type HostMetrics,
} from "@/lib/host";
import { Panel, timeAgo } from "@/components/dashboard/ui";
import {
  IconCpu,
  IconData,
  IconPulse,
  IconServer,
  IconTemp,
} from "@/components/icons";

type Tone = "ok" | "warn" | "crit";
type IconType = ComponentType<{
  size?: number;
  weight?: "regular" | "bold" | "fill";
  className?: string;
}>;

const BAR: Record<Tone, string> = {
  ok: "bg-up",
  warn: "bg-acc",
  crit: "bg-down",
};
const VALUE: Record<Tone, string> = {
  ok: "text-txt",
  warn: "text-acc",
  crit: "text-down",
};

function Tile({
  label,
  Icon,
  value,
  sub,
  pct,
  tone,
}: {
  label: string;
  Icon: IconType;
  value: string;
  sub?: string;
  /** 0–100; renders a meter bar. Omit for a plain tile. */
  pct?: number | null;
  /** Override the pct-derived tone. */
  tone?: Tone;
}) {
  const t: Tone = tone ?? usageTone(pct);
  const hasBar = pct != null && Number.isFinite(pct);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-inset p-3">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.09em] text-sec">
        <Icon size={12} className="text-dim" />
        {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`font-mono text-[20px] leading-none ${VALUE[t]}`}>
          {value}
        </span>
        {sub && <span className="font-mono text-[11px] text-dim">{sub}</span>}
      </div>
      {hasBar && (
        <div className="mt-0.5 h-[3px] rounded-full bg-track overflow-hidden">
          <div
            className={`h-full rounded-full ${BAR[t]}`}
            style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
          />
        </div>
      )}
    </div>
  );
}

function Spark({
  label,
  points,
  digits,
  unit,
}: {
  label: string;
  points: number[];
  digits: number;
  unit: string;
}) {
  const clean = points.filter((n) => Number.isFinite(n));
  if (clean.length < 2) return null;
  const W = 96;
  const H = 22;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const d = clean
    .map((n, i) => {
      const x = (i / (clean.length - 1)) * W;
      const y = H - ((n - min) / span) * (H - 3) - 1.5;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-dim w-[52px] shrink-0">
        {label}
      </span>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="shrink-0 text-acc/80"
        aria-hidden="true"
      >
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.25" />
      </svg>
      <span className="font-mono text-[10px] text-sec">
        {clean[clean.length - 1].toFixed(digits)}
        {unit}
      </span>
    </div>
  );
}

export function HostPanel({
  history,
  lastCycleAt,
  gated = false,
}: {
  history: HostHistoryPoint[];
  lastCycleAt: string | null;
  /**
   * True when the caller is below master_admin. `host_metrics` is master-only (0033),
   * so the panel is empty for a reason that is not "no data yet" — saying otherwise
   * tells the demo account to wait for something that will never arrive.
   */
  gated?: boolean;
}) {
  // The live snapshot is the newest history row. It used to come from
  // `agent_status.detail.host`, which anonymous readers can read — and it names the
  // machine and its kernel. `host_metrics` is gated to master_admin.
  const host: HostMetrics | null = latestHostMetrics(history);

  const title = (
    <span className="flex items-center gap-1.5">
      <IconServer size={13} weight="bold" className="text-acc" />
      {host?.label ?? "agent host"}
    </span>
  );

  if (!host) {
    return (
      <Panel title={title}>
        <p className="font-mono text-[11px] text-dim">
          {gated
            ? "Host telemetry is master-admin only — it names the machine the agent runs on."
            : "No host telemetry yet — attached to the next heartbeat."}
        </p>
      </Panel>
    );
  }

  const capturedIso = host.captured_at ?? lastCycleAt;
  const stale = isStale(capturedIso);
  const plat = host.platform ?? {};
  const cm = host.container_mem;
  const mem = host.mem;
  const disk = host.disk;
  const proc = host.process ?? {};
  const load1 = host.load?.[0] ?? null;
  const loadPct =
    load1 != null && host.cpu_count ? (load1 / host.cpu_count) * 100 : null;

  const series = history.map((p) => p.metrics ?? ({} as HostMetrics));
  const pick = (fn: (m: HostMetrics) => number | null | undefined) =>
    series.map(fn).filter((n): n is number => typeof n === "number");
  const memSpark = pick((m) => m.container_mem?.used_pct);
  const loadSpark = pick((m) => m.load?.[0]);
  const tempSpark = pick((m) => m.thermal_c);
  const hasSpark =
    memSpark.length > 1 || loadSpark.length > 1 || tempSpark.length > 1;

  const meta = [
    plat.system && plat.release && `${plat.system} ${plat.release}`,
    proc.git_sha && `git ${proc.git_sha}`,
    plat.python && `py ${plat.python}`,
    proc.cycles != null && `${proc.cycles} cycles`,
    proc.last_symbol && `last ${proc.last_symbol}`,
    proc.rss_mb != null && `rss ${formatMb(proc.rss_mb)}`,
    host.net?.alpaca_ms != null && `alpaca ${host.net.alpaca_ms} ms`,
    host.net?.supabase_ms != null && `supabase ${host.net.supabase_ms} ms`,
  ].filter(Boolean) as string[];

  return (
    <Panel
      title={title}
      right={
        <span
          className={`font-mono text-[10px] ${stale ? "text-acc" : "text-dim"}`}
        >
          {stale ? "stale · " : "updated "}
          {timeAgo(capturedIso)}
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {cm && (
            <Tile
              label="Container mem"
              Icon={IconData}
              value={formatMb(cm.used_mb)}
              sub={
                cm.limit_mb
                  ? `/ ${formatMb(cm.limit_mb)}${
                      cm.used_pct != null ? ` · ${cm.used_pct}%` : ""
                    }`
                  : undefined
              }
              pct={cm.used_pct ?? null}
            />
          )}
          {host.thermal_c != null && (
            <Tile
              label="CPU temp"
              Icon={IconTemp}
              value={`${host.thermal_c.toFixed(0)}°C`}
              pct={Math.min(100, (host.thermal_c / 90) * 100)}
              tone={
                host.thermal_c >= 80 ? "crit" : host.thermal_c >= 65 ? "warn" : "ok"
              }
            />
          )}
          {load1 != null && (
            <Tile
              label="Load 1m"
              Icon={IconCpu}
              value={load1.toFixed(2)}
              sub={host.cpu_count ? `/ ${host.cpu_count} cores` : undefined}
              pct={loadPct}
            />
          )}
          {disk && (
            <Tile
              label="Disk /"
              Icon={IconData}
              value={`${disk.used_pct}%`}
              sub={`${formatGb(disk.free_gb)} free`}
              pct={disk.used_pct}
            />
          )}
          {mem && (
            <Tile
              label="Host RAM"
              Icon={IconData}
              value={`${mem.used_pct}%`}
              sub={`${formatMb(mem.total_mb - mem.available_mb)} / ${formatGb(
                mem.total_mb / 1024,
              )}`}
              pct={mem.used_pct}
            />
          )}
          <Tile
            label="Uptime"
            Icon={IconPulse}
            value={formatUptime(host.uptime_seconds)}
            sub={
              proc.started_at ? `runner ${timeAgo(proc.started_at)}` : undefined
            }
          />
        </div>

        {hasSpark && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-rowline bg-inset/40 px-3 py-2.5">
            <Spark label="mem %" points={memSpark} digits={0} unit="%" />
            <Spark label="load" points={loadSpark} digits={2} unit="" />
            <Spark label="temp" points={tempSpark} digits={0} unit="°C" />
            <span className="font-mono text-[9px] text-faint ml-auto">
              {history.length} readings
            </span>
          </div>
        )}

        {meta.length > 0 && (
          <p className="font-mono text-[10px] text-faint leading-relaxed">
            {meta.join("  ·  ")}
          </p>
        )}
      </div>
    </Panel>
  );
}
