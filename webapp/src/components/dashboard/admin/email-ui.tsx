import type { ReactNode } from "react";
import Link from "next/link";
import { Panel } from "@/components/dashboard/ui";
import { IconEnvelope, IconProhibit } from "@/components/icons";

/** Shown wherever the email key is missing or the API call failed. */
export function ResendUnavailable({ message }: { message: string }) {
  const noKey = message === "not-configured";
  const forbidden = message === "forbidden";
  return (
    <Panel title={forbidden ? "Not available for your account" : "Email not configured"}>
      <div className="flex items-start gap-2 text-[13px] text-sec leading-relaxed">
        <IconEnvelope size={16} className="mt-0.5 shrink-0 text-dim" />
        {forbidden ? (
          <p>
            The email section is master-admin only: it reaches an account-wide
            third-party credential.
          </p>
        ) : noKey ? (
          <p>
            Set <span className="font-mono text-txt">RESEND_API_KEY</span> in the
            webapp environment (Vercel → Project → Environment Variables) to use
            this section. The key is server-side only and never reaches the
            browser.
          </p>
        ) : (
          <p>
            The email API returned an error:{" "}
            <span className="font-mono text-down">{message}</span>
          </p>
        )}
      </div>
    </Panel>
  );
}

/**
 * Shown when a template / campaign is opened by id but its sender is not on
 * the Beleth domain — the shared email account holds other projects' items.
 */
export function OutOfScope({ kind, backHref }: { kind: string; backHref: string }) {
  return (
    <Panel title="Not a Beleth item">
      <p className="flex items-start gap-2 text-[13px] text-sec leading-relaxed">
        <IconProhibit size={16} className="mt-0.5 shrink-0 text-dim" />
        This {kind} sends from another domain, so it belongs to a different
        project on the shared email account. It is not shown here.
      </p>
      <Link
        href={backHref}
        className="mt-3 inline-block font-mono text-[11px] uppercase tracking-[0.07em] text-acc hover:underline"
      >
        Back
      </Link>
    </Panel>
  );
}

const EVENT_TONE: Record<string, string> = {
  delivered: "bg-up/15 text-up",
  sent: "bg-acc/12 text-acc",
  opened: "bg-acc/15 text-acc",
  clicked: "bg-acc/20 text-acc",
  queued: "bg-chipbg text-sec",
  scheduled: "bg-chipbg text-sec",
  sending: "bg-acc/12 text-acc",
  draft: "bg-chipbg text-sec",
  bounced: "bg-down/15 text-down",
  complained: "bg-down/15 text-down",
  failed: "bg-down/15 text-down",
  canceled: "bg-chipbg text-dim",
  unknown: "bg-chipbg text-dim",
};

export function EventPill({ event }: { event: string }) {
  const tone = EVENT_TONE[event] ?? "bg-chipbg text-sec";
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.07em] ${tone}`}
    >
      {event}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-line bg-panel px-3 py-2.5">
      <div className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-faint">
        {label}
      </div>
      <div className="mt-1 text-[18px] font-light text-txt tabular-nums">
        {value}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-sec">{hint}</div>}
    </div>
  );
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
