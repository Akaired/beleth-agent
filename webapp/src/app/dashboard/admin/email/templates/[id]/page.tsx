import type { Metadata } from "next";
import Link from "next/link";
import { Panel } from "@/components/dashboard/ui";
import {
  ResendUnavailable,
  OutOfScope,
  EventPill,
  formatDateTime,
} from "@/components/dashboard/admin/email-ui";
import { TemplateEditor } from "@/components/dashboard/admin/template-editor";
import {
  getResendKey,
  tolerant,
  fetchTemplate,
  isBelethMail,
} from "@/lib/admin/email";
import { IconArrowLeft } from "@/components/icons";

export const metadata: Metadata = { title: "Admin · Email template — Beleth" };

export default async function EmailTemplatePage({
  params,
}: PageProps<"/dashboard/admin/email/templates/[id]">) {
  if (!getResendKey()) return <ResendUnavailable message="not-configured" />;

  const { id } = await params;
  const res = await tolerant(() => fetchTemplate(id));
  if (!res.ok) {
    // A bad id is a 404 from Resend; anything else is an API problem.
    return <ResendUnavailable message={res.message} />;
  }
  const t = res.data;

  // A template with an explicit non-Beleth sender belongs to another project.
  if (t.from && !isBelethMail(t.from)) {
    return <OutOfScope kind="template" backHref="/dashboard/admin/email/templates" />;
  }

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/dashboard/admin/email"
        className="flex w-fit items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.07em] text-sec transition-colors hover:text-txt"
      >
        <IconArrowLeft size={12} weight="bold" /> Email
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-light text-txt">{t.name}</h2>
        <div className="flex items-center gap-2">
          <EventPill event={t.status} />
          {t.hasUnpublishedVersions && (
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-sec">
              unpublished edits
            </span>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px] sm:grid-cols-4">
        {[
          ["Alias", t.alias ?? "—"],
          ["From", t.from ?? "inherits"],
          ["Reply-to", t.replyTo ?? "—"],
          ["Published", formatDateTime(t.publishedAt)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
              {k}
            </dt>
            <dd className="mt-0.5 text-sec">{v}</dd>
          </div>
        ))}
      </dl>

      {t.variables.length > 0 && (
        <Panel title="Variables">
          <ul className="flex flex-wrap gap-2">
            {t.variables.map((v) => (
              <li
                key={v.key}
                className="rounded border border-line px-2 py-1 font-mono text-[11px] text-sec"
                title={v.fallback ? `fallback: ${v.fallback}` : undefined}
              >
                {`{{{${v.key}}}}`}
                {v.type && <span className="ml-1 text-faint">{v.type}</span>}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Edit">
        <TemplateEditor
          id={t.id}
          initialSubject={t.subject ?? ""}
          initialHtml={t.html}
        />
      </Panel>
    </div>
  );
}
