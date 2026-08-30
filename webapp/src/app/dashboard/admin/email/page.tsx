import type { Metadata } from "next";
import { Panel } from "@/components/dashboard/ui";
import { fetchResendStatus, type ResendDomainStatus } from "@/lib/admin/email";
import {
  IconCheckCircle,
  IconWarning,
  IconXCircle,
  IconArrowUpRight,
} from "@/components/icons";

export const metadata: Metadata = { title: "Admin · Email — Beleth backoffice" };

// The address auth mail is sent from. Lives in Resend + the Supabase SMTP
// sender field, not in app code — repeated here only as display copy.
const SENDER_DOMAIN = "beleth.davidemaiorana.dev";
const SENDER_ADDRESS = `no-reply@${SENDER_DOMAIN}`;

function StatusPill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "bad";
  children: React.ReactNode;
}) {
  const map = {
    ok: { cls: "bg-up/15 text-up", Icon: IconCheckCircle },
    warn: { cls: "bg-chipbg text-sec", Icon: IconWarning },
    bad: { cls: "bg-down/15 text-down", Icon: IconXCircle },
  } as const;
  const { cls, Icon } = map[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${cls}`}
    >
      <Icon size={11} weight="bold" />
      {children}
    </span>
  );
}

function domainTone(status: ResendDomainStatus): "ok" | "warn" | "bad" {
  if (status === "verified") return "ok";
  if (status === "failed") return "bad";
  return "warn";
}

const SMTP_CHECKLIST: { label: string; hint: string }[] = [
  {
    label: "Resend domain verified",
    hint: `${SENDER_DOMAIN} — DKIM + SPF/MX records live in the Vercel DNS (account A).`,
  },
  {
    label: "Supabase Custom SMTP enabled",
    hint: "Authentication → Emails → SMTP: host smtp.resend.com, port 465, user resend, pass = a Resend API key.",
  },
  {
    label: `Sender set to ${SENDER_ADDRESS}`,
    hint: "Must sit on the verified domain or Resend rejects the send.",
  },
  {
    label: "“Confirm email” turned on",
    hint: "mailer_autoconfirm = false — until then signup is instant and reset mail never leaves.",
  },
  {
    label: "Redirect allow-list covers every origin",
    hint: "localhost, *.vercel.app previews, and the custom domain.",
  },
];

export default async function AdminEmailPage() {
  const status = await fetchResendStatus();

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Delivery path">
        <p className="text-[13px] text-sec leading-relaxed">
          The webapp sends no mail of its own. Supabase Auth produces the
          confirmation / password-reset messages and hands them to{" "}
          <span className="text-txt">Resend</span> over Custom SMTP, from{" "}
          <span className="font-mono text-txt">{SENDER_ADDRESS}</span>.
        </p>
      </Panel>

      <Panel
        title="Resend domains"
        right={
          <a
            href="https://resend.com/domains"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.07em] text-acc hover:underline"
          >
            Resend <IconArrowUpRight size={11} weight="bold" />
          </a>
        }
      >
        {!status.configured ? (
          <p className="text-[13px] text-sec leading-relaxed">
            No{" "}
            <span className="font-mono text-txt">RESEND_API_KEY</span> in the
            webapp environment, so the live domain status can&apos;t be read
            here. Add it in Vercel to light this panel up — the key is only used
            for this read-only check.
          </p>
        ) : "error" in status ? (
          <p className="flex items-start gap-2 text-[13px] text-down leading-relaxed">
            <IconWarning size={15} className="mt-0.5 shrink-0" />
            {status.error}
          </p>
        ) : status.domains.length === 0 ? (
          <p className="text-[13px] text-sec">
            The Resend account has no domains yet.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {status.domains.map((d) => (
              <li
                key={d.id}
                className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
              >
                <span className="font-mono text-[12.5px] text-txt">{d.name}</span>
                <span className="flex items-center gap-2">
                  {d.region && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-faint">
                      {d.region}
                    </span>
                  )}
                  <StatusPill tone={domainTone(d.status)}>{d.status}</StatusPill>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Custom SMTP checklist"
        right={
          <a
            href="https://supabase.com/dashboard/project/_/auth/templates"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.07em] text-acc hover:underline"
          >
            Supabase <IconArrowUpRight size={11} weight="bold" />
          </a>
        }
      >
        <ul className="flex flex-col gap-3">
          {SMTP_CHECKLIST.map((item) => (
            <li key={item.label} className="flex flex-col gap-0.5">
              <span className="text-[13px] text-txt">{item.label}</span>
              <span className="text-[12px] text-sec leading-relaxed">
                {item.hint}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
