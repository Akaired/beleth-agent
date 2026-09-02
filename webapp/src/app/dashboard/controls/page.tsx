import Link from "next/link";
import type { Metadata } from "next";
import { requireSession, roleAtLeast, isMasterAdmin } from "@/lib/auth";
import { fetchControlPanel } from "@/lib/dashboard-queries";
import { ForbiddenPanel, Panel, timeAgo } from "@/components/dashboard/ui";
import { KillSwitch } from "@/components/dashboard/kill-switch";
import { HostPanel } from "@/components/dashboard/host-panel";
import { EventList } from "@/components/dashboard/event-list";
import { IconArrowRight, IconControls } from "@/components/icons";

export const metadata: Metadata = { title: "Controls — Beleth backoffice" };

export default async function ControlsPage() {
  const ctx = await requireSession();
  if (!roleAtLeast(ctx.role, "demo_admin")) return <ForbiddenPanel />;

  // demo_admin sees the full operator view; only master_admin can flip the
  // kill switch (the server action and the RPC both re-check this).
  const canControl = isMasterAdmin(ctx.role);

  const { agentStatus, hostHistory, recentEvents } = await fetchControlPanel();
  const paused = agentStatus?.paused ?? false;
  const state = (agentStatus?.state ?? "unknown").replace(/_/g, " ");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h1 className="flex items-center gap-2 text-[18px] font-light">
          <IconControls size={17} weight="bold" className="text-acc" />
          Operational controls
        </h1>
        <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.08em]">
          <span
            className={`flex items-center gap-1.5 rounded border px-2 py-1 ${
              paused
                ? "border-killline text-down"
                : "border-emphline text-up"
            }`}
          >
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                paused ? "bg-down" : "bg-up"
              }`}
            />
            {paused ? "paused" : "running"}
          </span>
          <span className="rounded border border-line px-2 py-1 text-sec">
            {state}
          </span>
          <span className="rounded border border-line px-2 py-1 text-dim">
            cycle {timeAgo(agentStatus?.last_cycle_at ?? null)}
          </span>
        </div>
      </div>

      <HostPanel
        history={hostHistory}
        lastCycleAt={agentStatus?.last_cycle_at ?? null}
        gated={!canControl}
      />

      <Panel title="Kill switch">
        <KillSwitch paused={paused} canControl={canControl} />
      </Panel>

      <Panel
        title="Logs"
        right={
          <Link
            href="/dashboard/logs"
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.07em] text-acc hover:underline"
          >
            All logs <IconArrowRight size={11} weight="bold" />
          </Link>
        }
      >
        <EventList
          rows={recentEvents}
          dense
          emptyText="No agent events yet."
        />
      </Panel>
    </div>
  );
}
