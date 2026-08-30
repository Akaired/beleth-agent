import type { Metadata } from "next";
import Link from "next/link";
import { Panel } from "@/components/dashboard/ui";
import {
  ResendUnavailable,
  EventPill,
  formatDateTime,
} from "@/components/dashboard/admin/email-ui";
import { getResendKey, tolerant, fetchBroadcasts } from "@/lib/admin/email";
import { IconCaretRight, IconPlus } from "@/components/icons";

export const metadata: Metadata = { title: "Admin · Email campaigns — Beleth" };

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

export default async function EmailCampaignsPage() {
  if (!getResendKey()) return <ResendUnavailable message="not-configured" />;

  const res = await tolerant(fetchBroadcasts);
  if (!res.ok) return <ResendUnavailable message={res.message} />;
  const campaigns = res.data;

  return (
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
      {campaigns.length === 0 ? (
        <p className="text-[13px] text-sec leading-relaxed">
          No broadcasts yet. A campaign is a one-off marketing email sent to a
          Resend <Link href="/dashboard/admin/email/audiences" className="text-acc hover:underline">segment</Link>.
          Create one as a draft, review it, then send.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {campaigns.map((c) => (
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
  );
}
