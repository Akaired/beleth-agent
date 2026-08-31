"use client";

import { useActionState, useEffect, useState } from "react";
import {
  deactivateAccountAction,
  deleteAccountAction,
} from "@/app/dashboard/settings/account/actions";
import type { LifecycleResult } from "@/app/dashboard/settings/account/form-state";
import { Panel } from "@/components/dashboard/ui";
import { IconWarning, IconClose } from "@/components/icons";

type Mode = "deactivate" | "delete";

const DEACTIVATE_POINTS = [
  "You're signed out and can't use the dashboard, chat, or the forum.",
  "Nothing is deleted — your profile, posts, and progress stay intact.",
  "Sign back in any time to reactivate the account.",
];

const DELETE_POINTS = [
  "Your profile, experience, chat history, and every forum topic and reply you posted are permanently removed.",
  "This cannot be undone.",
];

const field =
  "w-full rounded bg-inset border border-inputline px-3.5 py-2.5 text-[13px] text-txt outline-none transition-colors placeholder:text-dim focus:border-hoverline";

function DangerRow({
  title,
  description,
  cta,
  onClick,
  disabled,
}: {
  title: string;
  description: string;
  cta: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3.5">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-txt">{title}</p>
        <p className="mt-0.5 text-[12px] text-sec">{description}</p>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="shrink-0 rounded border border-killline px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-down transition-colors hover:bg-blocked/25 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        {cta}
      </button>
    </div>
  );
}

function LifecycleDialog({
  mode,
  email,
  onClose,
}: {
  mode: Mode;
  email: string;
  onClose: () => void;
}) {
  const action =
    mode === "delete" ? deleteAccountAction : deactivateAccountAction;
  const [state, formAction, pending] = useActionState<
    LifecycleResult | null,
    FormData
  >(action, null);
  const [typed, setTyped] = useState("");
  const points = mode === "delete" ? DELETE_POINTS : DEACTIVATE_POINTS;
  const matches = typed.trim().toLowerCase() === email.toLowerCase();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [pending, onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Cancel"
        onClick={() => !pending && onClose()}
        className="absolute inset-0 bg-black/60"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === "delete" ? "Delete account" : "Deactivate account"}
        className="relative w-full max-w-md rounded-lg border border-killline bg-panel shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-4">
          <h2 className="flex items-center gap-2 text-[14px] font-medium text-txt">
            <IconWarning size={15} className="text-down" />
            {mode === "delete"
              ? "Delete your account"
              : "Deactivate your account"}
          </h2>
          <button
            type="button"
            onClick={() => !pending && onClose()}
            aria-label="Close"
            className="text-dim transition-colors hover:text-sec"
          >
            <IconClose size={15} />
          </button>
        </div>

        <div className="px-5 py-3">
          <ul className="flex flex-col gap-1.5">
            {points.map((p) => (
              <li
                key={p}
                className="flex items-start gap-2 text-[12.5px] leading-relaxed text-sec"
              >
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-dim" />
                {p}
              </li>
            ))}
          </ul>

          <form action={formAction} className="mt-4 flex flex-col gap-2">
            <label className="font-mono text-[10px] uppercase tracking-[0.1em] text-sec">
              Type <span className="text-txt">{email}</span> to confirm
            </label>
            <input
              className={field}
              type="email"
              name="confirm_email"
              autoComplete="off"
              placeholder={email}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />

            {state && !state.ok && (
              <p className="text-[12px] text-down">{state.error}</p>
            )}

            <div className="mt-1 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => !pending && onClose()}
                className="rounded px-3 py-2 text-[12px] text-sec transition-colors hover:text-txt"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!matches || pending}
                className="rounded border border-killline bg-blocked/25 px-3.5 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-down transition-colors hover:bg-blocked/40 disabled:opacity-40"
              >
                {pending
                  ? "Working…"
                  : mode === "delete"
                    ? "Delete account"
                    : "Deactivate account"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export function DangerZone({
  email,
  isMasterAdmin,
}: {
  email: string | null;
  isMasterAdmin: boolean;
}) {
  const [mode, setMode] = useState<Mode | null>(null);

  return (
    <Panel
      title={
        <span className="flex items-center gap-2 text-down">
          <IconWarning size={14} />
          Danger zone
        </span>
      }
    >
      {isMasterAdmin ? (
        <p className="text-[12.5px] text-sec">
          The master-admin account keeps the backoffice reachable for the
          judges — it can&apos;t be deactivated or deleted from here.
        </p>
      ) : !email ? (
        <p className="text-[12.5px] text-sec">
          Account lifecycle actions need an email address on the account.
        </p>
      ) : (
        <div className="divide-y divide-line">
          <DangerRow
            title="Deactivate account"
            description="Suspend the account. Reversible — sign back in to restore it."
            cta="Deactivate"
            onClick={() => setMode("deactivate")}
          />
          <DangerRow
            title="Delete account"
            description="Permanently erase the account and everything tied to it."
            cta="Delete"
            onClick={() => setMode("delete")}
          />
        </div>
      )}

      {mode && email && (
        <LifecycleDialog
          mode={mode}
          email={email}
          onClose={() => setMode(null)}
        />
      )}
    </Panel>
  );
}
