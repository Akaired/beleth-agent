import type { Metadata } from "next";
import Link from "next/link";
import { Panel } from "@/components/dashboard/ui";
import {
  ResendUnavailable,
  EventPill,
  formatDateTime,
} from "@/components/dashboard/admin/email-ui";
import { StarterTemplates } from "@/components/dashboard/admin/starter-templates";
import {
  getResendKey,
  tolerant,
  fetchBelethTemplates,
  BELETH_MAIL_DOMAIN,
} from "@/lib/admin/email";
import { STARTER_TEMPLATES } from "@/lib/admin/email-templates";
import { IconArrowUpRight, IconCaretRight } from "@/components/icons";

export const metadata: Metadata = { title: "Admin · Email templates — Beleth" };

export default async function EmailTemplatesPage() {
  if (!getResendKey()) return <ResendUnavailable message="not-configured" />;

  const res = await tolerant(fetchBelethTemplates);
  if (!res.ok) return <ResendUnavailable message={res.message} />;
  const templates = res.data;
  const existingAliases = templates
    .map((t) => t.alias)
    .filter((a): a is string => Boolean(a));

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Templates"
        right={
          <a
            href="https://resend.com/templates"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.07em] text-acc hover:underline"
          >
            New in Resend <IconArrowUpRight size={11} weight="bold" />
          </a>
        }
      >
        {templates.length === 0 ? (
          <p className="text-[13px] text-sec leading-relaxed">
            No templates sending from{" "}
            <span className="font-mono text-txt">{BELETH_MAIL_DOMAIN}</span> yet —
            provision the starter set below, or create one in the Resend
            dashboard.
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
    </div>
  );
}
