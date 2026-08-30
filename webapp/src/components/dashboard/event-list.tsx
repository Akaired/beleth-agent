import Link from "next/link";
import type { ComponentType } from "react";
import { eventLabel, type AgentEvent, type EventLevel } from "@/lib/events";
import { timeAgo } from "@/components/dashboard/ui";
import {
  IconExit,
  IconPause,
  IconProhibit,
  IconRefused,
  IconResume,
  IconScales,
  IconServer,
  IconTarget,
  IconTrades,
  IconWarning,
  IconXCircle,
} from "@/components/icons";

type IconType = ComponentType<{
  size?: number;
  weight?: "regular" | "bold" | "fill";
  className?: string;
}>;

type Tone = "up" | "down" | "warn" | "info" | "muted";

const TONE_CLASS: Record<Tone, string> = {
  up: "text-up",
  down: "text-down",
  warn: "text-acc",
  info: "text-sec",
  muted: "text-dim",
};

/** Per-event icon + colour. Play=green / Pause=red mirrors the old control history. */
const EVENT_VIS: Record<string, { Icon: IconType; tone: Tone }> = {
  runner_start: { Icon: IconResume, tone: "up" },
  runner_stop: { Icon: IconPause, tone: "muted" },
  clock_unavailable: { Icon: IconWarning, tone: "warn" },
  switch_unreadable: { Icon: IconWarning, tone: "down" },
  paused: { Icon: IconPause, tone: "down" },
  resumed: { Icon: IconResume, tone: "up" },
  decision: { Icon: IconScales, tone: "info" },
  no_trade: { Icon: IconProhibit, tone: "muted" },
  risk_rejected: { Icon: IconRefused, tone: "warn" },
  order_submitted: { Icon: IconTrades, tone: "up" },
  order_failed: { Icon: IconXCircle, tone: "down" },
  exit_triggered: { Icon: IconTarget, tone: "warn" },
  exit_submitted: { Icon: IconExit, tone: "up" },
  exit_failed: { Icon: IconXCircle, tone: "down" },
  position_anomaly: { Icon: IconWarning, tone: "warn" },
  error: { Icon: IconXCircle, tone: "down" },
};

const LEVEL_TONE: Record<EventLevel, Tone> = {
  debug: "muted",
  info: "info",
  warn: "warn",
  error: "down",
};

function visFor(e: AgentEvent): { Icon: IconType; tone: Tone } {
  return EVENT_VIS[e.event] ?? { Icon: IconServer, tone: LEVEL_TONE[e.level] };
}

/**
 * Renders a list of `agent_events`. Used compact on the Controls page and full
 * on the Logs tab — the only difference is `dense` (drops the absolute
 * timestamp column) and the empty-state copy.
 */
export function EventList({
  rows,
  dense = false,
  emptyText = "No events yet.",
}: {
  rows: AgentEvent[];
  dense?: boolean;
  emptyText?: string;
}) {
  if (rows.length === 0) {
    return <p className="font-mono text-[11px] text-dim py-2">{emptyText}</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-rowline -my-1.5">
      {rows.map((e) => {
        const { Icon, tone } = visFor(e);
        const backfilled = e.context?.["backfill"] === true;
        return (
          <li key={e.id} className="flex items-start gap-3 py-2">
            <Icon
              size={14}
              weight="bold"
              className={`mt-[3px] shrink-0 ${TONE_CLASS[tone]}`}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span
                  className={`font-mono text-[10px] uppercase tracking-[0.07em] ${TONE_CLASS[tone]}`}
                >
                  {eventLabel(e.event)}
                </span>
                {e.symbol && (
                  <span className="font-mono text-[10px] text-sec">
                    {e.symbol}
                  </span>
                )}
                <span className="font-mono text-[10px] text-dim">
                  {timeAgo(e.created_at)}
                </span>
                {backfilled && (
                  <span
                    className="font-mono text-[9px] uppercase tracking-[0.08em] text-faint"
                    title="Reconstructed from the record — not emitted live"
                  >
                    backfill
                  </span>
                )}
                {!dense && (
                  <span className="ml-auto font-mono text-[10px] text-faint hidden sm:block">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                )}
              </div>
              <p className="text-[12px] leading-snug text-sec break-words">
                {e.message}
                {e.decision_id && (
                  <Link
                    href={`/dashboard/decisions/${e.decision_id}`}
                    className="ml-1.5 font-mono text-[10px] text-acc hover:underline"
                  >
                    decision ↗
                  </Link>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
