import type { Metadata } from "next";
import { requireSession, roleAtLeast } from "@/lib/auth";
import { fetchLatestStrategyConfig } from "@/lib/dashboard-queries";
import { ForbiddenPanel, Panel } from "@/components/dashboard/ui";
import { IconStrategy } from "@/components/icons";

export const metadata: Metadata = { title: "Strategy — Beleth backoffice" };

export default async function StrategyPage() {
  const ctx = await requireSession();
  if (!roleAtLeast(ctx.role, "demo_admin")) return <ForbiddenPanel />;

  const { config, asOf, agentVersion } = await fetchLatestStrategyConfig();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="flex items-center gap-2 text-[18px] font-light">
          <IconStrategy size={17} weight="bold" className="text-acc" />
          Strategy configuration
        </h1>
        <span className="font-mono text-[10.5px] text-dim">
          {asOf ? `snapshot ${new Date(asOf).toLocaleString()}` : "no snapshot"}
          {agentVersion ? ` · agent ${agentVersion}` : ""}
        </span>
      </div>

      <p className="text-[12px] text-sec leading-relaxed">
        This is the exact <code className="font-mono text-[11px]">config/strategy.yaml</code>{" "}
        the agent stamped onto its most recent decision — the parameters that
        produced it. Read-only here; the reasoning behind each value lives in{" "}
        <code className="font-mono text-[11px]">docs/strategy.md</code>.
      </p>

      <Panel title="strategy.yaml (as of last decision)">
        {config ? (
          <pre className="text-[11px] leading-relaxed font-mono text-pre-output bg-inset border border-line rounded p-3 overflow-x-auto">
            {JSON.stringify(config, null, 2)}
          </pre>
        ) : (
          <p className="text-[12px] text-dim">
            No decision with a config snapshot recorded yet.
          </p>
        )}
      </Panel>
    </div>
  );
}
