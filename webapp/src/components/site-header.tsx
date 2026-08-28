import { agentStateLine } from "@/lib/queries";
import type { AgentStatusRow } from "@/lib/queries";

const STATE_TONE: Record<string, string> = {
  up: "bg-up",
  acc: "bg-acc",
  down: "bg-down",
  dim: "bg-faint",
};

export function SiteHeader({ agentStatus }: { agentStatus: AgentStatusRow | null }) {
  const state = agentStateLine(agentStatus);
  return (
    <header className="flex items-center justify-between gap-6 h-12 px-4 md:px-[clamp(16px,3vw,40px)] border-b border-line">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/beleth.png"
          alt="Beleth"
          width={20}
          height={23}
          className="w-5 [image-rendering:pixelated]"
        />
        <span className="font-mono text-[13px] font-medium tracking-[0.14em]">BELETH</span>
        <span className="text-xs text-dim hidden sm:inline">Autonomous options agent</span>
      </div>
      <nav className="flex items-center gap-5">
        <a
          href="#method"
          className="text-[12.5px] text-sec hover:text-acc transition-colors"
        >
          Method
        </a>
        {state && (
          <span className="hidden md:flex items-center gap-2 font-mono text-[10px] tracking-[0.08em] text-sec">
            <span className={`w-1.5 h-1.5 rounded-full ${STATE_TONE[state.tone]}`} />
            {state.label}
          </span>
        )}
      </nav>
    </header>
  );
}