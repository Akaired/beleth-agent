"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createStarterTemplateAction,
  createAllStarterTemplatesAction,
} from "@/app/dashboard/admin/email/actions";
import { IconCheckCircle, IconWarning, IconCaretDown } from "@/components/icons";

export type StarterPreset = {
  alias: string;
  name: string;
  subject: string;
  description: string;
  html: string;
};

export function StarterTemplates({
  presets,
  existingAliases,
}: {
  presets: StarterPreset[];
  existingAliases: string[];
}) {
  const router = useRouter();
  const have = new Set(existingAliases);
  const missing = presets.filter((p) => !have.has(p.alias));

  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function createOne(alias: string) {
    setError(null);
    setBusy(alias);
    startTransition(async () => {
      const res = await createStarterTemplateAction(alias);
      setBusy(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function createAll() {
    setError(null);
    setBusy("__all__");
    startTransition(async () => {
      const res = await createAllStarterTemplatesAction();
      setBusy(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-sec leading-relaxed">
          The classic set, in the Beleth style. Provisioning creates and
          publishes the template in Resend — edit it afterwards from the list
          above.
        </p>
        {missing.length > 0 && (
          <button
            type="button"
            onClick={createAll}
            disabled={pending}
            className="shrink-0 rounded border border-emphline px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-acc transition-colors hover:bg-acc/10 disabled:opacity-40"
          >
            {busy === "__all__" ? "Creating…" : `Create all ${missing.length}`}
          </button>
        )}
      </div>

      <ul className="flex flex-col divide-y divide-line">
        {presets.map((p) => {
          const exists = have.has(p.alias);
          const isOpen = open === p.alias;
          return (
            <li key={p.alias} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-txt">{p.name}</span>
                    <span className="font-mono text-[10.5px] text-faint">{p.alias}</span>
                    {exists && (
                      <span className="inline-flex items-center gap-1 rounded bg-up/15 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.08em] text-up">
                        <IconCheckCircle size={10} weight="bold" /> in Resend
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[12px] text-sec">
                    <span className="text-dim">Subject:</span> {p.subject}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-sec leading-relaxed">
                    {p.description}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? null : p.alias)}
                    className="flex items-center gap-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-sec transition-colors hover:text-txt"
                  >
                    Preview
                    <IconCaretDown
                      size={11}
                      weight="bold"
                      className={isOpen ? "rotate-180" : ""}
                    />
                  </button>
                  {!exists && (
                    <button
                      type="button"
                      onClick={() => createOne(p.alias)}
                      disabled={pending}
                      className="rounded border border-emphline px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-acc transition-colors hover:bg-acc/10 disabled:opacity-40"
                    >
                      {busy === p.alias ? "Creating…" : "Create"}
                    </button>
                  )}
                </div>
              </div>

              {isOpen && (
                <iframe
                  title={`${p.name} preview`}
                  sandbox=""
                  srcDoc={p.html}
                  className="mt-3 h-[420px] w-full rounded border border-line bg-white"
                />
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p className="flex items-start gap-2 font-mono text-[11px] text-down">
          <IconWarning size={13} className="mt-px shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
