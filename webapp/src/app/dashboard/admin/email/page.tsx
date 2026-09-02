import type { Metadata } from "next";
import Link from "next/link";
import { getSessionContext, isMasterAdmin } from "@/lib/auth";
import { MasterOnlyPanel, Panel } from "@/components/dashboard/ui";
import {
  ResendUnavailable,
  EventPill,
  Stat,
  formatDateTime,
} from "@/components/dashboard/admin/email-ui";
import { StarterTemplates } from "@/components/dashboard/admin/starter-templates";
import {
  getResendKey,
  tolerant,
  fetchBelethDomains,
  fetchBelethRecentEmails,
  fetchBelethTemplates,
  fetchBelethBroadcasts,
  tallyEvents,
  BELETH_MAIL_DOMAIN,
  type ResendDomainStatus,
} from "@/lib/admin/email";
import { STARTER_TEMPLATES } from "@/lib/admin/email-templates";
import {
  IconCaretRight,
  IconCheckCircle,
  IconPlus,
  IconWarning,
} from "@/components/icons";

export const metadata: Metadata = { title: "Admin · Email — Beleth backoffice" };

function domainTone(status: ResendDomainStatus): "ok" | "warn" | "bad" {
  if (status === "verified") return "ok";
  if (status === "failed") return "bad";
  return "warn";
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

function whenLabel(b: {
  status: string;
  createdAt: string | null;
  scheduledAt: string | null;
  sentAt: string | null;
}): string {
  if (b.status === "sent" && b.sentAt) return `sent ${formatDateTime(b.sentAt)}`;
  if (b.scheduledAt) return `scheduled ${formatDateTime(b.scheduledAt)}`;
  return `created ${formatDateTime(b.createdAt)}`;
}

/**
 * The whole Email section on one page — reporting, sending domains, recent
 * mail, transactional templates (+ the starter set) and marketing campaigns.
 * No sub-tabs; the template / campaign editors are the only child routes.
 */
export default async function AdminEmailPage() {
  const ctx = await getSessionContext();
  // The admin shell opens to demo_admin so the judges can read the Forum tab; this
  // section is master-admin only and has to say so itself. It reads Resend, whose key
  // is account-wide, and the demo login is public.
  if (!ctx || !isMasterAdmin(ctx.role)) return <MasterOnlyPanel />;

  if (!getResendKey()) {
    return <ResendUnavailable message="not-configured" />;
  }

  const [domainsR, emailsR, templatesR, broadcastsR] = await Promise.all([
    tolerant(fetchBelethDomains),
    tolerant(() => fetchBelethRecentEmails(100)),
    tolerant(fetchBelethTemplates),
    tolerant(fetchBelethBroadcasts),
  ]);

  const domains = domainsR.ok ? domainsR.data : [];
  const verifiedDomains = domains.filter((d) => d.status === "verified").length;

  const recent = emailsR.ok ? emailsR.data : { emails: [], hasMore: false, scanned: 0 };
  const tally = tallyEvents(recent.emails);
  const total = recent.emails.length;
  const delivered =
    (tally.delivered ?? 0) + (tally.opened ?? 0) + (tally.clicked ?? 0);
  const opened = (tally.opened ?? 0) + (tally.clicked ?? 0);
  const bounced = (tally.bounced ?? 0) + (tally.complained ?? 0);

  const templates = templatesR.ok ? templatesR.data.templates : [];
  const hiddenNoSender = templatesR.ok ? templatesR.data.hiddenNoSender : 0;
  const hiddenForeign = templatesR.ok ? templatesR.data.hiddenForeign : 0;
  const existingAliases = templates
    .map((t) => t.alias)
    .filter((a): a is string => Boolean(a));

  const broadcasts = broadcastsR.ok ? broadcastsR.data : [];

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Recent sends" value={total} />
        <Stat label="Delivered" value={pct(delivered, total)} />
        <Stat label="Opened" value={pct(opened, total)} />
        <Stat label="Bounced" value={bounced} />
        <Stat label="Templates" value={templates.length} />
        <Stat label="Campaigns" value={broadcasts.length} />
      </div>

      {!emailsR.ok && emailsR.message !== "not-configured" && (
        <p className="flex items-center gap-2 font-mono text-[11px] text-down">
          <IconWarning size={13} /> sent-mail read failed: {emailsR.message}
        </p>
      )}

      <Panel title="Sending domains">
        {!domainsR.ok ? (
          <p className="text-[12px] text-down">
            Could not load domains: {domainsR.message}
          </p>
        ) : domains.length === 0 ? (
          <p className="text-[13px] text-sec">No verified sending domain yet.</p>
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
        {domains.length > 0 && (
          <p className="mt-3 font-mono text-[10.5px] text-faint">
            {verifiedDomains} verified · {domains.length} shown
          </p>
        )}
      </Panel>

      <Panel title="Recent sent mail">
        {total === 0 ? (
          <p className="text-[13px] text-sec">Nothing in the recent window.</p>
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
      </Panel>

      <Panel title="Templates">
        {templates.length === 0 ? (
          <p className="text-[13px] text-sec leading-relaxed">
            No templates sending from{" "}
            <span className="font-mono text-txt">{BELETH_MAIL_DOMAIN}</span> yet —
            provision the starter set below.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {templates.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/dashboard/admin/email/templates/${t.id}`}
                  className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0 transition-colors hover:text-txt"
                >
                  <span className="flex-1">
                    <span className="text-[13px] text-txt">{t.name}</span>
                    {t.alias && (
                      <span className="ml-2 font-mono text-[11px] text-faint">
                        {t.alias}
                      </span>
                    )}
                    <span className="mt-0.5 block font-mono text-[10.5px] text-sec">
                      updated {formatDateTime(t.updatedAt)}
                    </span>
                  </span>
                  <EventPill event={t.status} />
                  <IconCaretRight size={12} weight="bold" className="text-faint" />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {(hiddenNoSender > 0 || hiddenForeign > 0) && (
          <p className="mt-3 font-mono text-[10.5px] text-faint">
            {hiddenForeign > 0 && `${hiddenForeign} hidden (other project) · `}
            {hiddenNoSender > 0 &&
              `${hiddenNoSender} hidden (no sender set — add a from on ${BELETH_MAIL_DOMAIN} to show)`}
          </p>
        )}
      </Panel>

      <Panel title="Starter templates">
        <StarterTemplates
          presets={STARTER_TEMPLATES.map((t) => ({
            alias: t.alias,
            name: t.name,
            subject: t.subject,
            description: t.description,
            html: t.html,
          }))}
          existingAliases={existingAliases}
        />
      </Panel>

      <Panel
        title="Campaigns"
        right={
          <Link
            href="/dashboard/admin/email/campaigns/new"
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.07em] text-acc hover:underline"
          >
            <IconPlus size={11} weight="bold" /> New campaign
          </Link>
        }
      >
        {broadcasts.length === 0 ? (
          <p className="text-[13px] text-sec leading-relaxed">
            No broadcasts yet. A campaign is a one-off marketing email sent to a
            segment. Create one as a draft, review it, then send.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {broadcasts.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/dashboard/admin/email/campaigns/${c.id}`}
                  className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0 transition-colors hover:text-txt"
                >
                  <span className="flex-1">
                    <span className="text-[13px] text-txt">{c.name}</span>
                    <span className="mt-0.5 block font-mono text-[10.5px] text-sec">
                      {whenLabel(c)}
                    </span>
                  </span>
                  <EventPill event={c.status} />
                  <IconCaretRight size={12} weight="bold" className="text-faint" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
