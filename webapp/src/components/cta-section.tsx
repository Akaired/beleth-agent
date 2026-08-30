import Link from "next/link";
import { IconGithub, IconSignIn } from "@/components/icons";

export function CtaSection() {
  return (
    <section className="px-4 md:px-[clamp(16px,3vw,40px)] pb-[clamp(48px,7vw,88px)]">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 border-t border-line pt-10">
        <div>
          <h2 className="text-xl font-semibold tracking-[-0.01em]">
            The account is open for reading.
          </h2>
          <p className="mt-2 text-[13.5px] leading-[1.6] text-sec max-w-[60ch]">
            Every decision the agent has ever made is in it, refusals included — persisted
            to a public database as each cycle runs. The code, the strategy notes, and
            the data layer are all in the open.
          </p>
        </div>
        <div className="flex flex-col gap-2.5 self-start md:self-auto">
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 bg-txt text-bg text-[13px] font-medium px-[18px] py-[10px] rounded-[2px] hover:bg-acc transition-colors whitespace-nowrap"
          >
            <IconSignIn size={15} weight="fill" />
            Log in / Register
          </Link>
          <a
            href="https://github.com/Akaired/beleth-agent"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-2 bg-txt text-bg text-[13px] font-medium px-[18px] py-[10px] rounded-[2px] hover:bg-acc transition-colors whitespace-nowrap"
          >
            <IconGithub size={15} weight="fill" />
            View the source on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}