import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { fetchControlPanel } from "@/lib/dashboard-queries";
import { Panel, timeAgo } from "@/components/dashboard/ui";
import { KillSwitch } from "@/components/dashboard/kill-switch";
import { HostPanel } from "@/components/dashboard/host-panel";
import {
  IconControls,
  IconHistory,
  IconPause,
  IconProhibit,
  IconResume,
} from "@/components/icons";

export const metadata: Metadata = { title: "Controls — Beleth backoffice" };

export default async function ControlsPage() {
  const ctx = await requireSession();
  if (ctx.role !== "master_admin") {
    return (
      <Panel title="Not available for your account">
        <p className="flex items-start gap-2 text-[13px] text-sec leading-relaxed">
          <IconProhibit size={16} className="mt-0.5 shrink-0 text-dim" />
          Operational controls are the master-admin account only. The
          demo-admin backoffice is read-only by design — it can see every
          decision and every risk-check rejection, but it never touches the
          agent.
        </p>
      </Panel>
    );
  }

  const { agentStatus, events, hostHistory } = await fetchControlPanel();
  const paused = agentStatus?.paused ?? false;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="flex items-center gap-2 text-[18px] font-light">
          <IconControls size={17} weight="bold" className="text-acc" />
          Operational controls
        </h1>
        <span className="font-mono text-[10.5px] text-dim">
          agent state: {(agentStatus?.state ?? "unknown").replace(/_/g, " ")} ·
          cycle {timeAgo(agentStatus?.last_cycle_at ?? null)}
        </span>
      </div>

      <p className="text-[12px] text-sec leading-relaxed max-w-prose">
        The webapp reads the decision log the agent writes; this is the only
        page that writes back, and it writes exactly one field. Config editing
        and Alpaca account detail are not built yet — they need agent-side
        changes first.
      </p>

      <HostPanel
        detail={agentStatus?.detail ?? null}
        history={hostHistory}
        lastCycleAt={agentStatus?.last_cycle_at ?? null}
      />

      <Panel title="Kill switch">
        <KillSwitch paused={paused} />
      </Panel>

      <Panel title="Control history">
        {events.length === 0 ? (
          <p className="flex items-center gap-2 text-[12px] text-dim">
            <IconHistory size={14} />
            No kill-switch changes recorded.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-rowline -my-1">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex items-center gap-3 py-2 font-mono text-[11px]"
              >
                <span
                  className={`flex w-[86px] shrink-0 items-center gap-1.5 uppercase tracking-[0.06em] ${
                    e.action === "pause" ? "text-down" : "text-up"
                  }`}
                >
                  {e.action === "pause" ? (
                    <IconPause size={12} weight="bold" />
                  ) : (
                    <IconResume size={12} weight="bold" />
                  )}
                  {e.action}
                </span>
                <span className="text-sec w-[150px] shrink-0">
                  {timeAgo(e.created_at)}
                </span>
                <span className="text-dim truncate">
                  {e.actor_email ?? "unknown"}
                </span>
                <span className="text-faint ml-auto shrink-0 hidden sm:block">
                  {new Date(e.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
