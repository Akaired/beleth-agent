import Link from "next/link";
import { agentStateLine } from "@/lib/queries";
import type { AgentStatusRow } from "@/lib/queries";
import { IconLive } from "@/components/icons";
import { MarketChip } from "@/components/market-chip";

export function SiteHeader({
  agentStatus,
  marketOpen,
}: {
  agentStatus: AgentStatusRow | null;
  marketOpen?: boolean | null;
}) {
  const state = agentStateLine(agentStatus);
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center justify-between gap-6 px-4 md:px-[clamp(16px,3vw,40px)]">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/beleth.png"
            alt="Beleth"
            width={20}
            height={23}
            className="w-5 [image-rendering:pixelated]"
          />
          <span className="font-mono text-[13px] font-medium tracking-[0.14em]">
            BELETH
          </span>
          <span className="hidden text-xs text-dim sm:inline">
            Autonomous options trading agent
          </span>
        </div>
        <nav className="flex items-center gap-5">
          <a
            href="#method"
            className="text-[12.5px] text-sec transition-colors hover:text-acc"
          >
            Method
          </a>
          <Link
            href="/dashboard"
            className="text-[12.5px] text-sec transition-colors hover:text-acc"
          >
            Dashboard
          </Link>
          {state && (
            <span className="hidden items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] text-sec md:flex">
              <IconLive
                size={11}
                weight="fill"
                className={
                  state.tone === "up"
                    ? "text-up"
                    : state.tone === "acc"
                      ? "text-acc"
                      : state.tone === "down"
                        ? "text-down"
                        : "text-faint"
                }
              />
              {state.label}
            </span>
          )}
          <MarketChip open={marketOpen} bordered />
        </nav>
      </div>
    </header>
  );
}
