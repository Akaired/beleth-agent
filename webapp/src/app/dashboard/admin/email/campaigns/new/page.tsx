import type { Metadata } from "next";
import Link from "next/link";
import { Panel } from "@/components/dashboard/ui";
import { ResendUnavailable } from "@/components/dashboard/admin/email-ui";
import { CampaignForm } from "@/components/dashboard/admin/campaign-form";
import {
  getResendKey,
  tolerant,
  fetchSegments,
  BELETH_MAIL_DOMAIN,
} from "@/lib/admin/email";
import { IconArrowLeft } from "@/components/icons";

export const metadata: Metadata = { title: "Admin · New campaign — Beleth" };

export default async function NewCampaignPage() {
  if (!getResendKey()) return <ResendUnavailable message="not-configured" />;

  const res = await tolerant(fetchSegments);
  if (!res.ok) return <ResendUnavailable message={res.message} />;

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/dashboard/admin/email/campaigns"
        className="flex w-fit items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.07em] text-sec transition-colors hover:text-txt"
      >
        <IconArrowLeft size={12} weight="bold" /> Campaigns
      </Link>
      <h2 className="text-[17px] font-light text-txt">New campaign</h2>
      <Panel title="Draft">
        <CampaignForm
          segments={res.data.map((s) => ({ id: s.id, name: s.name }))}
          defaultFrom={`Beleth <no-reply@${BELETH_MAIL_DOMAIN}>`}
        />
      </Panel>
    </div>
  );
}
