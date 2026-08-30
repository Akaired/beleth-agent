import type { Metadata } from "next";
import Link from "next/link";
import { Panel } from "@/components/dashboard/ui";
import {
  ResendUnavailable,
  EventPill,
  Stat,
  formatDateTime,
} from "@/components/dashboard/admin/email-ui";
import {
  getResendKey,
  tolerant,
  fetchDomains,
  fetchRecentEmails,
  fetchTemplates,
  fetchBroadcasts,
  tallyEvents,
  type ResendDomainStatus,
} from "@/lib/admin/email";
import { IconArrowUpRight, IconCheckCircle, IconWarning } from "@/components/icons";

export const metadata: Metadata = { title: "Admin · Email — Beleth backoffice" };

// Sender for auth mail — configured in Resend + the Supabase SMTP form, shown
// here only as copy.
const SENDER_DOMAIN = "beleth.davidemaiorana.dev";
const SENDER_ADDRESS = `no-reply@${SENDER_DOMAIN}`;

function domainTone(status: ResendDomainStatus): "ok" | "warn" | "bad" {
  if (status === "verified") return "ok";
  if (status === "failed") return "bad";
  return "warn";
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

function DeliveryPath() {
  return (
    <Panel title="Delivery path">
      <p className="text-[13px] text-sec leading-relaxed">
        The webapp sends no mail of its own. Supabase Auth produces the
        confirmation / password-reset messages and hands them to{" "}
        <span className="text-txt">Resend</span> over Custom SMTP, from{" "}
        <span className="font-mono text-txt">{SENDER_ADDRESS}</span>. Marketing
        mail goes out as Resend <span className="text-txt">broadcasts</span>,
        driven from the Campaigns tab.
      </p>
    </Panel>
  );
}

const SMTP_CHECKLIST: { label: string; hint: string }[] = [
  {
    label: "Resend domain verified",
    hint: `${SENDER_DOMAIN} — DKIM + SPF/MX live in the Vercel DNS (account A).`,
  },
  {
    label: "Supabase Custom SMTP enabled",
    hint: "Auth → Emails → SMTP: smtp.resend.com:465, user resend, pass = a Resend API key.",
  },
  {
    label: `Sender ${SENDER_ADDRESS}`,
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

function SmtpChecklist() {
  return (
    <Panel
      title="Auth mail — Custom SMTP checklist"
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
            <span className="text-[12px] text-sec leading-relaxed">{item.hint}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default async function AdminEmailOverviewPage() {
  if (!getResendKey()) {
    return (
      <div className="flex flex-col gap-5">
        <ResendUnavailable message="not-configured" />
        <DeliveryPath />
        <SmtpChecklist />
      </div>
    );
  }

  const [domainsR, emailsR, templatesR, broadcastsR] = await Promise.all([
    tolerant(fetchDomains),
    tolerant(() => fetchRecentEmails(100)),
    tolerant(fetchTemplates),
    tolerant(fetchBroadcasts),
  ]);

  const domains = domainsR.ok ? domainsR.data : [];
  const verifiedDomains = domains.filter((d) => d.status === "verified").length;

  const recent = emailsR.ok ? emailsR.data : { emails: [], hasMore: false };
  const tally = tallyEvents(recent.emails);
  const total = recent.emails.length;
  const delivered = (tally.delivered ?? 0) + (tally.opened ?? 0) + (tally.clicked ?? 0);
  const opened = (tally.opened ?? 0) + (tally.clicked ?? 0);
  const bounced = (tally.bounced ?? 0) + (tally.complained ?? 0);

  const templateCount = templatesR.ok ? templatesR.data.length : 0;
  const broadcasts = broadcastsR.ok ? broadcastsR.data : [];
  const sentCampaigns = broadcasts.filter((b) => b.status === "sent").length;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat
          label="Recent sends"
          value={recent.hasMore ? `${total}+` : total}
          hint="last 100 window"
        />
        <Stat label="Delivered" value={pct(delivered, total)} hint={`${delivered} of ${total}`} />
        <Stat label="Opened" value={pct(opened, total)} hint={`${opened} tracked`} />
        <Stat label="Bounced" value={bounced} hint="+ complaints" />
        <Stat label="Templates" value={templateCount} />
        <Stat
          label="Campaigns"
          value={broadcasts.length}
          hint={`${sentCampaigns} sent`}
        />
      </div>

      {!emailsR.ok && emailsR.message !== "not-configured" && (
        <p className="flex items-center gap-2 font-mono text-[11px] text-down">
          <IconWarning size={13} /> sent-mail read failed: {emailsR.message}
        </p>
      )}

      <Panel
        title="Sending domains"
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
        {!domainsR.ok ? (
          <p className="text-[12px] text-down">Could not load domains: {domainsR.message}</p>
        ) : domains.length === 0 ? (
          <p className="text-[13px] text-sec">No domains in this Resend account yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {domains.map((d) => {
              const tone = domainTone(d.status);
              return (
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
                    <span
                      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] ${
                        tone === "ok"
                          ? "bg-up/15 text-up"
                          : tone === "bad"
                            ? "bg-down/15 text-down"
                            : "bg-chipbg text-sec"
                      }`}
                    >
                      {tone === "ok" && <IconCheckCircle size={11} weight="bold" />}
                      {d.status}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 font-mono text-[10.5px] text-faint">
          {verifiedDomains} verified · {domains.length} total
        </p>
      </Panel>

      <Panel title="Recent sent mail">
        {total === 0 ? (
          <p className="text-[13px] text-sec">
            Nothing in the recent window. Auth mail only shows here once Custom
            SMTP is routing through Resend.
          </p>
        ) : (
          <div className="-mx-4 -my-4 overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-table-head text-sec">
                <tr className="text-left font-mono text-[10px] uppercase tracking-[0.08em]">
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">To</th>
                  <th className="px-4 py-2 font-medium">Subject</th>
                  <th className="px-4 py-2 font-medium">Last event</th>
                </tr>
              </thead>
              <tbody>
                {recent.emails.slice(0, 15).map((e) => (
                  <tr key={e.id} className="border-t border-rowline">
                    <td className="whitespace-nowrap px-4 py-2 text-sec">
                      {formatDateTime(e.createdAt)}
                    </td>
                    <td className="px-4 py-2 font-mono text-[11px] text-txt">
                      {e.to.join(", ") || "—"}
                    </td>
                    <td className="max-w-[280px] truncate px-4 py-2 text-sec">
                      {e.subject}
                    </td>
                    <td className="px-4 py-2">
                      <EventPill event={e.lastEvent} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-4 text-[11px] text-sec">
          Resend&apos;s API paginates without a total — for the all-time count and
          the full deliverability breakdown, open the{" "}
          <a
            href="https://resend.com/emails"
            target="_blank"
            rel="noopener noreferrer"
            className="text-acc hover:underline"
          >
            Resend dashboard
          </a>
          .
        </p>
      </Panel>

      <DeliveryPath />
      <SmtpChecklist />

      <p className="text-[11px] text-sec">
        Manage <Link href="/dashboard/admin/email/templates" className="text-acc hover:underline">templates</Link>{" "}
        and <Link href="/dashboard/admin/email/campaigns" className="text-acc hover:underline">campaigns</Link> in their own tabs.
      </p>
    </div>
  );
}
