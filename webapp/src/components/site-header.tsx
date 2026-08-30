import Link from "next/link";
import { agentStateLine } from "@/lib/queries";
import type { AgentStatusRow } from "@/lib/queries";
import { IconLive, IconSignIn } from "@/components/icons";
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
        <nav className="flex items-center gap-4">
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
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 rounded-[2px] bg-txt px-3 py-[7px] text-[12px] font-medium text-bg transition-colors hover:bg-acc"
          >
            <IconSignIn size={13} weight="fill" />
            Log in / Register
          </Link>
        </nav>
      </div>
    </header>
  );
}
