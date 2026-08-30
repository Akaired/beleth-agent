import Link from "next/link";
import { IconCode, IconGithub } from "@/components/icons";

const REPO = "https://github.com/Akaired/beleth-agent";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-7 px-4 py-12 md:px-[clamp(16px,3vw,40px)]">
        <nav className="flex flex-wrap justify-center gap-x-8 gap-y-3 text-[12.5px] text-sec">
          <Link href="/dashboard" className="transition-colors hover:text-acc">
            Dashboard
          </Link>
          <Link href="/docs" className="transition-colors hover:text-acc">
            Docs
          </Link>
          <Link href="/forum" className="transition-colors hover:text-acc">
            Forum
          </Link>
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 transition-colors hover:text-acc"
          >
            <IconGithub size={14} />
            Source
          </a>
        </nav>

        <div className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/beleth.png"
            alt="Beleth"
            width={18}
            height={21}
            className="w-[18px] opacity-60 [image-rendering:pixelated]"
          />
          <span className="font-mono text-[13px] font-medium tracking-[0.14em] text-sec">
            BELETH
          </span>
        </div>

        <div className="flex flex-col items-center gap-3">
          <p className="text-center text-[11px] leading-relaxed text-faint">
            © 2026 Beleth Options Trading Agent. Built in Italy
            for the Alpaca AI Trading Agents Hackathon (lablab.ai). Trading involves risk.
          </p>
          <a
            href="https://davidemaiorana.dev/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-6 items-center gap-1.5 rounded-full bg-[#F5F3EF] px-2.5 transition-transform hover:-translate-y-0.5"
          >
            <IconCode size={12} weight="bold" className="text-[#0E9F63]" />
            <span className="text-[13px] font-semibold tracking-[0.02em] text-[#5A6167]">
              davidemaiorana.dev
            </span>
          </a>
        </div>
      </div>
    </footer>
  );
}
