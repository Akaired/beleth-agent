import {
  formatGb,
  formatMb,
  formatUptime,
  isStale,
  parseHostMetrics,
  usageTone,
  type HostHistoryPoint,
  type HostMetrics,
} from "@/lib/host";
import { Panel, timeAgo } from "@/components/dashboard/ui";
import { IconControls } from "@/components/icons";

const TONE_BAR: Record<"ok" | "warn" | "crit", string> = {
  ok: "bg-up",
  warn: "bg-acc",
  crit: "bg-down",
};
const TONE_TXT: Record<"ok" | "warn" | "crit", string> = {
  ok: "text-txt",
  warn: "text-acc",
  crit: "text-down",
};

function Meter({
  label,
  pct,
  value,
}: {
  label: string;
  pct: number | null | undefined;
  value: string;
}) {
  const tone = usageTone(pct);
  const width = pct == null ? 0 : Math.max(2, Math.min(100, pct));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] tracking-[0.08em] text-sec uppercase">
          {label}
        </span>
        <span className={`font-mono text-[11px] ${TONE_TXT[tone]}`}>{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-track overflow-hidden">
        <div
          className={`h-full rounded-full ${TONE_BAR[tone]}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

/** Minimal inline-SVG sparkline over the history window. */
function Spark({
  label,
  points,
  unit,
  tone = "text-sec",
}: {
  label: string;
  points: number[];
  unit: string;
  tone?: string;
}) {
  const clean = points.filter((n) => Number.isFinite(n));
  if (clean.length < 2) return null;
  const W = 120;
  const H = 28;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const d = clean
    .map((n, i) => {
      const x = (i / (clean.length - 1)) * W;
      const y = H - ((n - min) / span) * (H - 4) - 2;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = clean[clean.length - 1];
  return (
    <div className="flex items-center gap-2.5">
      <span className="font-mono text-[10px] tracking-[0.08em] text-sec uppercase w-[68px] shrink-0">
        {label}
      </span>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="shrink-0 text-acc"
        aria-hidden="true"
      >
        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.25" />
      </svg>
      <span className={`font-mono text-[11px] ${tone}`}>
        {last.toFixed(unit === "°C" ? 0 : unit === "" ? 2 : 0)}
        {unit && ` ${unit}`}
      </span>
    </div>
  );
}

function Fact({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-[11px] text-sec">{children}</span>;
}

export function HostPanel({
  detail,
  history,
  lastCycleAt,
}: {
  detail: Record<string, unknown> | null | undefined;
  history: HostHistoryPoint[];
  lastCycleAt: string | null;
}) {
  const host: HostMetrics | null = parseHostMetrics(detail);

  if (!host) {
    return (
      <Panel title="Host">
        <p className="font-mono text-[11px] text-dim">
          No host telemetry yet — the runner attaches it to the next
          heartbeat/cycle.
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
    load1 != null && host.cpu_count
      ? (load1 / host.cpu_count) * 100
      : null;

  const series = history.map((p) => p.metrics ?? ({} as HostMetrics));
  const memPctSeries = series
    .map((m) => m.container_mem?.used_pct)
    .filter((n): n is number => typeof n === "number");
  const loadSeries = series
    .map((m) => m.load?.[0])
    .filter((n): n is number => typeof n === "number");
  const tempSeries = series
    .map((m) => m.thermal_c)
    .filter((n): n is number => typeof n === "number");

  return (
    <Panel
      title={
        <span className="flex items-center gap-1.5">
          <IconControls size={12} weight="bold" className="text-acc" />
          Host — {host.label ?? "the trading host"}
        </span>
      }
      right={
        <span
          className={`font-mono text-[10px] ${
            stale ? "text-acc" : "text-dim"
          }`}
        >
          {stale ? "stale · " : ""}
          {timeAgo(capturedIso)}
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        {/* identity strip */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Fact>
            {[plat.system, plat.release].filter(Boolean).join(" ") || "—"}
            {plat.machine ? ` · ${plat.machine}` : ""}
          </Fact>
          <Fact>up {formatUptime(host.uptime_seconds)}</Fact>
          {host.cpu_count != null && <Fact>{host.cpu_count} CPU</Fact>}
          {proc.git_sha && <Fact>git {proc.git_sha}</Fact>}
          {plat.python && <Fact>py {plat.python}</Fact>}
        </div>

        {/* meters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3.5">
          {cm && (
            <Meter
              label="container mem"
              pct={cm.used_pct ?? null}
              value={
                cm.limit_mb
                  ? `${formatMb(cm.used_mb)} / ${formatMb(cm.limit_mb)}${
                      cm.used_pct != null ? ` · ${cm.used_pct}%` : ""
                    }`
                  : formatMb(cm.used_mb)
              }
            />
          )}
          {disk && (
            <Meter
              label="disk /"
              pct={disk.used_pct}
              value={`${formatGb(disk.free_gb)} free / ${formatGb(
                disk.total_gb,
              )} · ${disk.used_pct}%`}
            />
          )}
          {mem && (
            <Meter
              label="host ram"
              pct={mem.used_pct}
              value={`${formatMb(mem.total_mb - mem.available_mb)} / ${formatGb(
                mem.total_mb / 1024,
              )} · ${mem.used_pct}%`}
            />
          )}
          {load1 != null && (
            <Meter
              label="load (1m)"
              pct={loadPct}
              value={
                host.load
                  ? `${host.load.map((n) => n.toFixed(2)).join(" · ")}${
                      host.cpu_count ? ` / ${host.cpu_count}` : ""
                    }`
                  : load1.toFixed(2)
              }
            />
          )}
          {host.thermal_c != null && (
            <Meter
              label="cpu temp"
              pct={Math.min(100, (host.thermal_c / 90) * 100)}
              value={`${host.thermal_c.toFixed(0)} °C`}
            />
          )}
        </div>

        {/* sparklines */}
        {(memPctSeries.length > 1 ||
          loadSeries.length > 1 ||
          tempSeries.length > 1) && (
          <div className="flex flex-col gap-2 pt-1 border-t border-rowline">
            <Spark label="mem %" points={memPctSeries} unit="%" />
            <Spark label="load" points={loadSeries} unit="" />
            <Spark label="temp" points={tempSeries} unit="°C" />
            <span className="font-mono text-[9.5px] text-faint">
              last {history.length} readings
            </span>
          </div>
        )}

        {/* runner line */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 border-t border-rowline">
          {proc.cycles != null && <Fact>cycles {proc.cycles}</Fact>}
          {proc.started_at && (
            <Fact>runner up {timeAgo(proc.started_at)}</Fact>
          )}
          {proc.rss_mb != null && <Fact>rss {formatMb(proc.rss_mb)}</Fact>}
          {proc.last_symbol && <Fact>last {proc.last_symbol}</Fact>}
          {host.net?.supabase_ms != null && (
            <Fact>supabase {host.net.supabase_ms} ms</Fact>
          )}
          {host.net?.alpaca_ms != null && (
            <Fact>alpaca {host.net.alpaca_ms} ms</Fact>
          )}
        </div>
      </div>
    </Panel>
  );
}
