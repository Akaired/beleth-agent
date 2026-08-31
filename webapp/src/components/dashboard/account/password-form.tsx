"use client";

import { useActionState } from "react";
import { changePasswordAction } from "@/app/dashboard/settings/account/actions";
import {
  EMPTY_STATE,
  type FormState,
} from "@/app/dashboard/settings/account/form-state";
import { IconLock } from "@/components/icons";

const field =
  "w-full rounded bg-inset border border-inputline px-3.5 py-2.5 text-[13px] text-txt outline-none transition-colors placeholder:text-dim focus:border-hoverline";
const labelRow =
  "flex items-center gap-1.5 font-mono text-[10px] tracking-[0.1em] text-sec";

export function PasswordForm() {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    changePasswordAction,
    EMPTY_STATE,
  );

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className={labelRow}>
          <IconLock size={12} />
          CURRENT PASSWORD
        </span>
        <input
          className={field}
          type="password"
          name="current_password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelRow}>NEW PASSWORD</span>
        <input
          className={field}
          type="password"
          name="new_password"
          autoComplete="new-password"
          placeholder="8+ characters"
          minLength={8}
          required
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelRow}>CONFIRM NEW PASSWORD</span>
        <input
          className={field}
          type="password"
          name="confirm_password"
          autoComplete="new-password"
          placeholder="8+ characters"
          minLength={8}
          required
        />
      </label>

      {state.error && <p className="text-[12px] text-down">{state.error}</p>}
      {state.notice && <p className="text-[12px] text-up">{state.notice}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 w-fit rounded bg-acc px-4 py-2.5 font-mono text-[11px] font-medium tracking-[0.1em] text-bg transition-colors hover:bg-acc/90 disabled:opacity-50"
      >
        {pending ? "…" : "UPDATE PASSWORD"}
      </button>
    </form>
  );
}
