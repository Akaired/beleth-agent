import type { Metadata } from "next";
import Link from "next/link";
import { Panel } from "@/components/dashboard/ui";
import { ResendUnavailable } from "@/components/dashboard/admin/email-ui";
import { CampaignForm } from "@/components/dashboard/admin/campaign-form";
import {
  getResendKey,
  tolerant,
  fetchBelethSegments,
  BELETH_MAIL_DOMAIN,
} from "@/lib/admin/email";
import { campaignStarterHtml } from "@/lib/admin/email-templates";
import { IconArrowLeft } from "@/components/icons";

export const metadata: Metadata = { title: "Admin · New campaign — Beleth" };

export default async function NewCampaignPage() {
  if (!getResendKey()) return <ResendUnavailable message="not-configured" />;

  const res = await tolerant(fetchBelethSegments);
  if (!res.ok) return <ResendUnavailable message={res.message} />;
  const { segments, scanned } = res.data;

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/dashboard/admin/email"
        className="flex w-fit items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.07em] text-sec transition-colors hover:text-txt"
      >
        <IconArrowLeft size={12} weight="bold" /> Email
      </Link>
      <h2 className="text-[17px] font-light text-txt">New campaign</h2>
      <Panel title="Draft">
        {segments.length === 0 ? (
          <p className="text-[13px] text-sec leading-relaxed">
            No Beleth segment to send to. Of {scanned} segment
            {scanned === 1 ? "" : "s"} in the shared email account, none has
            &ldquo;beleth&rdquo; in its name — that is the only signal that a
            segment is ours, so campaigns are limited to those. Name or create a
            Beleth segment with the email provider, then reload.
          </p>
        ) : (
          <CampaignForm
            segments={segments.map((s) => ({ id: s.id, name: s.name }))}
            defaultFrom={`Beleth <no-reply@${BELETH_MAIL_DOMAIN}>`}
            defaultHtml={campaignStarterHtml()}
          />
        )}
      </Panel>
    </div>
  );
}
