"use client";

import { useActionState, useState } from "react";
import {
  updateProfileAction,
  EMPTY_STATE,
  type FormState,
} from "@/app/dashboard/account/actions";
import { IconAccount } from "@/components/icons";

const field =
  "w-full rounded bg-inset border border-inputline px-3.5 py-2.5 text-[13px] text-txt outline-none transition-colors placeholder:text-dim focus:border-hoverline";
const labelRow =
  "flex items-center gap-1.5 font-mono text-[10px] tracking-[0.1em] text-sec";

const BIO_MAX = 280;

export function ProfileForm({
  displayName,
  bio,
}: {
  displayName: string | null;
  bio: string | null;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    updateProfileAction,
    EMPTY_STATE,
  );
  const [bioLen, setBioLen] = useState((bio ?? "").length);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className={labelRow}>
          <IconAccount size={12} />
          NICKNAME
        </span>
        <input
          className={field}
          type="text"
          name="display_name"
          defaultValue={displayName ?? ""}
          placeholder="How Beleth should address you"
          minLength={2}
          maxLength={40}
          autoComplete="nickname"
        />
        <span className="font-mono text-[10px] text-dim">
          2–40 characters. Shown across the dashboard and the forum. Leave empty
          to fall back to your email name.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="flex items-center justify-between">
          <span className={labelRow}>BIO</span>
          <span className="font-mono text-[10px] text-dim">
            {bioLen}/{BIO_MAX}
          </span>
        </span>
        <textarea
          className={`${field} min-h-[84px] resize-y`}
          name="bio"
          defaultValue={bio ?? ""}
          maxLength={BIO_MAX}
          placeholder="A line or two about you (optional)"
          onChange={(e) => setBioLen(e.target.value.length)}
        />
      </label>

      {state.error && <p className="text-[12px] text-down">{state.error}</p>}
      {state.notice && <p className="text-[12px] text-up">{state.notice}</p>}

      <button
        type="submit"
        disabled={pending}
        className="mt-1 w-fit rounded bg-acc px-4 py-2.5 font-mono text-[11px] font-medium tracking-[0.1em] text-bg transition-colors hover:bg-acc/90 disabled:opacity-50"
      >
        {pending ? "…" : "SAVE PROFILE"}
      </button>
    </form>
  );
}
