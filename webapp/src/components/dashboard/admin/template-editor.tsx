"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateTemplateAction } from "@/app/dashboard/admin/email/actions";
import { IconCheckCircle, IconWarning } from "@/components/icons";

/**
 * Edit a Resend template's subject + HTML. Two-step save (an armed confirm),
 * a live sandboxed preview, and a dirty guard so the button only lights up
 * when something actually changed. The write is a server action that
 * re-checks master-admin.
 */
export function TemplateEditor({
  id,
  initialSubject,
  initialHtml,
}: {
  id: string;
  initialSubject: string;
  initialHtml: string;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(initialSubject);
  const [html, setHtml] = useState(initialHtml);
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const dirty = subject !== initialSubject || html !== initialHtml;

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await updateTemplateAction(id, { subject, html });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setArmed(false);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
          Subject
        </span>
        <input
          value={subject}
          onChange={(e) => {
            setSubject(e.target.value);
            setSaved(false);
          }}
          className="rounded border border-inputline bg-inset px-3 py-1.5 text-[13px] text-txt focus:border-acc focus:outline-none"
        />
      </label>

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
            HTML body
          </span>
          <textarea
            value={html}
            onChange={(e) => {
              setHtml(e.target.value);
              setSaved(false);
            }}
            spellCheck={false}
            className="h-[420px] resize-y rounded border border-inputline bg-inset px-3 py-2 font-mono text-[11.5px] leading-relaxed text-txt focus:border-acc focus:outline-none"
          />
        </label>
        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-faint">
            Preview
          </span>
          <iframe
            title="Template preview"
            sandbox=""
            srcDoc={html || "<p style='font:14px system-ui;color:#888'>Empty body</p>"}
            className="h-[420px] w-full rounded border border-line bg-white"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        {!armed ? (
          <button
            type="button"
            disabled={!dirty}
            onClick={() => {
              setError(null);
              setArmed(true);
            }}
            className="w-fit rounded border border-emphline px-3 py-1.5 font-mono text-[12px] uppercase tracking-[0.06em] text-acc transition-colors hover:bg-acc/10 disabled:opacity-40"
          >
            Save changes
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded border border-emphline bg-acc/15 px-3 py-1.5 font-mono text-[12px] uppercase tracking-[0.06em] text-acc transition-colors hover:bg-acc/25 disabled:opacity-50"
            >
              {pending ? "Saving…" : "Confirm save"}
            </button>
            <button
              type="button"
              onClick={() => setArmed(false)}
              disabled={pending}
              className="rounded border border-line px-3 py-1.5 font-mono text-[12px] uppercase tracking-[0.06em] text-sec transition-colors hover:text-txt disabled:opacity-50"
            >
              Cancel
            </button>
          </>
        )}
        {saved && !dirty && (
          <span className="flex items-center gap-1 font-mono text-[11px] text-up">
            <IconCheckCircle size={12} weight="fill" /> saved
          </span>
        )}
      </div>

      {error && (
        <p className="flex items-start gap-2 font-mono text-[11px] text-down">
          <IconWarning size={13} className="mt-px shrink-0" />
          {error}
        </p>
      )}

      <p className="text-[11px] text-sec leading-relaxed">
        Editing the published version directly. Resend variable tags like{" "}
        <span className="font-mono text-txt">{"{{name}}"}</span> are preserved
        verbatim — the preview shows them literally.
      </p>
    </div>
  );
}
