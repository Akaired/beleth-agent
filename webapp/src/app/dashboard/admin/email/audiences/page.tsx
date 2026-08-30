import type { Metadata } from "next";
import { Panel } from "@/components/dashboard/ui";
import {
  ResendUnavailable,
  formatDateTime,
} from "@/components/dashboard/admin/email-ui";
import { getResendKey, tolerant, fetchSegments } from "@/lib/admin/email";
import { IconArrowUpRight } from "@/components/icons";

export const metadata: Metadata = { title: "Admin · Email audiences — Beleth" };

export default async function EmailAudiencesPage() {
  if (!getResendKey()) return <ResendUnavailable message="not-configured" />;

  const res = await tolerant(fetchSegments);
  if (!res.ok) return <ResendUnavailable message={res.message} />;

  // Segments carry no sender domain — the only signal is the name. Show the
  // ones that name Beleth; if none do, fall back to all so the view is never
  // mysteriously empty.
  const belethNamed = res.data.filter((s) => /beleth/i.test(s.name));
  const scoped = belethNamed.length > 0;
  const segments = scoped ? belethNamed : res.data;

  return (
    <Panel
      title="Segments"
      right={
        <a
          href="https://resend.com/audiences"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.07em] text-acc hover:underline"
        >
          Manage in Resend <IconArrowUpRight size={11} weight="bold" />
        </a>
      }
    >
      {segments.length === 0 ? (
        <p className="text-[13px] text-sec leading-relaxed">
          No segments yet. A campaign sends to a segment, so create at least one
          in Resend before building a campaign.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {segments.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <span className="text-[13px] text-txt">{s.name}</span>
              <span className="font-mono text-[10.5px] text-sec">
                created {formatDateTime(s.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-sec leading-relaxed">
        {scoped
          ? "Showing segments whose name mentions Beleth. "
          : "No Beleth-named segment — showing all. "}
        Contact lists live in Resend — this view is read-only, and the API
        reports no per-segment contact total.
      </p>
    </Panel>
  );
}
