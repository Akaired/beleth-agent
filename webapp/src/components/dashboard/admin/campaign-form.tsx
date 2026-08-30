"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBroadcastAction } from "@/app/dashboard/admin/email/actions";
import { IconWarning } from "@/components/icons";

type SegmentOption = { id: string; name: string };

export function CampaignForm({
  segments,
  defaultFrom,
  defaultHtml,
}: {
  segments: SegmentOption[];
  defaultFrom: string;
  defaultHtml: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [segmentId, setSegmentId] = useState(segments[0]?.id ?? "");
  const [from, setFrom] = useState(defaultFrom);
  const [subject, setSubject] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [html, setHtml] = useState(defaultHtml);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const canSubmit = segmentId && from.trim() && subject.trim();

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createBroadcastAction({
        segmentId,
        from: from.trim(),
        subject: subject.trim(),
        name: name.trim() || undefined,
        previewText: previewText.trim() || undefined,
        html,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/dashboard/admin/email/campaigns/${res.id}`);
    });
  }

  const field =
    "rounded border border-inputline bg-inset px-3 py-1.5 text-[13px] text-txt focus:border-acc focus:outline-none";
  const labelCls = "font-mono text-[10px] uppercase tracking-[0.1em] text-faint";

  if (segments.length === 0) {
    return (
      <p className="text-[13px] text-sec leading-relaxed">
        No Resend segments to send to. Create one in the{" "}
        <a
          href="https://resend.com/audiences"
          target="_blank"
          rel="noopener noreferrer"
          className="text-acc hover:underline"
        >
          Resend dashboard
        </a>{" "}
        first, then reload this page.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Internal name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="Sept product update" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Segment</span>
          <select value={segmentId} onChange={(e) => setSegmentId(e.target.value)} className={field}>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>From</span>
          <input value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>Subject</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} className={field} />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className={labelCls}>Preview text</span>
        <input value={previewText} onChange={(e) => setPreviewText(e.target.value)} className={field} placeholder="Shown after the subject in the inbox list" />
      </label>

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={labelCls}>HTML body</span>
          <textarea
            value={html}
            onChange={(e) => setHtml(e.target.value)}
            spellCheck={false}
            className="h-[360px] resize-y rounded border border-inputline bg-inset px-3 py-2 font-mono text-[11.5px] leading-relaxed text-txt focus:border-acc focus:outline-none"
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className={labelCls}>Preview</span>
          <iframe
            title="Campaign preview"
            sandbox=""
            srcDoc={html || "<p style='font:14px system-ui;color:#888'>Empty body</p>"}
            className="h-[360px] w-full rounded border border-line bg-white"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit || pending}
          className="w-fit rounded border border-emphline px-3 py-1.5 font-mono text-[12px] uppercase tracking-[0.06em] text-acc transition-colors hover:bg-acc/10 disabled:opacity-40"
        >
          {pending ? "Creating…" : "Create draft"}
        </button>
        <span className="text-[11px] text-sec">
          Saved as a draft — nothing is sent until you confirm it on the next screen.
        </span>
      </div>

      {error && (
        <p className="flex items-start gap-2 font-mono text-[11px] text-down">
          <IconWarning size={13} className="mt-px shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
