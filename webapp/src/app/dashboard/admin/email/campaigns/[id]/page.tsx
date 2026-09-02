import type { Metadata } from "next";
import Link from "next/link";
import { getSessionContext } from "@/lib/auth";
import { MasterOnlyPanel, Panel } from "@/components/dashboard/ui";
import {
  ResendUnavailable,
  OutOfScope,
  EventPill,
  Stat,
  formatDateTime,
} from "@/components/dashboard/admin/email-ui";
import { CampaignActions } from "@/components/dashboard/admin/campaign-actions";
import {
  getResendKey,
  tolerant,
  fetchBroadcast,
  fetchBroadcastEngagement,
  fetchSegments,
  isBelethMail,
  type Engagement,
} from "@/lib/admin/email";
import { IconArrowLeft } from "@/components/icons";

export const metadata: Metadata = { title: "Admin · Campaign — Beleth" };

export default async function CampaignPage({
  params,
}: PageProps<"/dashboard/admin/email/campaigns/[id]">) {
  const ctx = await getSessionContext();
  // The admin shell opens to demo_admin so the judges can read the Forum tab; this
  // section is master-admin only and has to say so itself. It reads Resend, whose key
  // is account-wide, and the demo login is public.
  if (!ctx || ctx.role !== "master_admin") return <MasterOnlyPanel />;

  if (!getResendKey()) return <ResendUnavailable message="not-configured" />;

  const { id } = await params;
  const res = await tolerant(() => fetchBroadcast(id));
  if (!res.ok) return <ResendUnavailable message={res.message} />;
  const b = res.data;

  // A broadcast that doesn't send from the Beleth domain is another project's.
  if (!isBelethMail(b.from)) {
    return <OutOfScope kind="campaign" backHref="/dashboard/admin/email/campaigns" />;
  }

  // Resolve the segment name (best-effort) and, for a sent campaign, engagement.
  const [segmentsR, engagementR] = await Promise.all([
    tolerant(fetchSegments),
    b.status === "sent"
      ? tolerant(() => fetchBroadcastEngagement(id))
      : Promise.resolve({ ok: true as const, data: {} as Engagement }),
  ]);
  const segmentName =
    segmentsR.ok && b.segmentId
      ? segmentsR.data.find((s) => s.id === b.segmentId)?.name ?? null
      : null;
  const recipientLabel = segmentName ?? (b.segmentId ? `segment ${b.segmentId.slice(0, 8)}…` : "its segment");
  const engagement = engagementR.ok ? engagementR.data : {};

  const meta: [string, string][] = [
    ["Segment", segmentName ?? b.segmentId ?? b.audienceId ?? "—"],
    ["From", b.from ?? "—"],
    ["Reply-to", b.replyTo ?? "—"],
    ["Created", formatDateTime(b.createdAt)],
    ["Scheduled", formatDateTime(b.scheduledAt)],
    ["Sent", formatDateTime(b.sentAt)],
  ];

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/dashboard/admin/email"
        className="flex w-fit items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.07em] text-sec transition-colors hover:text-txt"
      >
        <IconArrowLeft size={12} weight="bold" /> Email
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-light text-txt">{b.name}</h2>
        <EventPill event={b.status} />
      </div>

      <div>
        <p className="text-[13px] text-txt">{b.subject ?? "(no subject)"}</p>
        {b.previewText && (
          <p className="mt-0.5 text-[12px] text-sec">{b.previewText}</p>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px] sm:grid-cols-3">
        {meta.map(([k, v]) => (
          <div key={k}>
            <dt className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">{k}</dt>
            <dd className="mt-0.5 truncate text-sec" title={v}>{v}</dd>
          </div>
        ))}
      </dl>

      {b.status === "sent" && (
        <Panel title="Engagement">
          {Object.keys(engagement).length === 0 ? (
            <p className="text-[12px] text-sec">
              No engagement data yet — recipient reads are cached for up to 15
              minutes after a send.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
              {(["delivered", "opened", "clicked", "bounced", "complained"] as const).map(
                (t) => {
                  const e = engagement[t];
                  return (
                    <Stat
                      key={t}
                      label={t}
                      value={e ? (e.capped ? `${e.count}+` : e.count) : "—"}
                    />
                  );
                },
              )}
            </div>
          )}
          <p className="mt-3 text-[11px] text-sec">
            Counts are read from the recipients endpoint and capped at 100 per
            state.
          </p>
        </Panel>
      )}

      <Panel title="Preview">
        {b.html.trim() ? (
          <iframe
            title="Campaign body"
            sandbox=""
            srcDoc={b.html}
            className="min-h-[360px] w-full rounded border border-line bg-white"
          />
        ) : (
          <p className="text-[12px] text-sec">No HTML body on this broadcast.</p>
        )}
      </Panel>

      <Panel title="Actions">
        <CampaignActions
          id={b.id}
          name={b.name}
          status={b.status}
          recipientLabel={recipientLabel}
        />
      </Panel>
    </div>
  );
}
