import { IconGithub, IconEye } from "@/components/icons";
import { CtaAuthButton } from "@/components/cta-auth-button";
import { demoSignInAction } from "@/app/login/actions";

const CTA_BTN =
  "inline-flex items-center justify-center gap-2 bg-txt text-bg text-[13px] font-medium px-[18px] py-[10px] rounded-[2px] hover:bg-acc transition-colors whitespace-nowrap";

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
          <div className="flex gap-2.5">
            <form action={demoSignInAction} className="flex-1">
              <button type="submit" className={`${CTA_BTN} w-full`}>
                <IconEye size={15} weight="fill" />
                Demo
              </button>
            </form>
            <CtaAuthButton className={`${CTA_BTN} flex-1`} />
          </div>
          <a
            href="https://github.com/Akaired/beleth-agent"
            target="_blank"
            rel="noreferrer"
            className={CTA_BTN}
          >
            <IconGithub size={15} weight="fill" />
            View the source on GitHub
          </a>
        </div>
      </div>
    </section>
  );
}