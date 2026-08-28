"use client";

import { useActionState, useState } from "react";
import {
  signInAction,
  signUpAction,
  type AuthState,
} from "@/app/login/actions";
import { IconEnvelope, IconLock } from "@/components/icons";

const INITIAL: AuthState = { error: null, notice: null };

const field =
  "w-full bg-inset border border-inputline rounded px-3 py-2 text-[13px] text-txt outline-none focus:border-hoverline transition-colors";

export function LoginForm({ next }: { next: string }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const action = mode === "signin" ? signInAction : signUpAction;
  const [state, formAction, pending] = useActionState(action, INITIAL);

  return (
    <div className="w-full max-w-sm">
      <div className="flex gap-1 mb-6 font-mono text-[11px] tracking-[0.08em]">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`px-3 py-1.5 rounded transition-colors ${
              mode === m
                ? "bg-chipbg text-txt"
                : "text-dim hover:text-sec"
            }`}
          >
            {m === "signin" ? "SIGN IN" : "SIGN UP"}
          </button>
        ))}
      </div>

      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="next" value={next} />
        <label className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 text-[11px] text-sec">
            <IconEnvelope size={12} />
            Email
          </span>
          <input
            className={field}
            type="email"
            name="email"
            autoComplete="email"
            required
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 text-[11px] text-sec">
            <IconLock size={12} />
            Password
          </span>
          <input
            className={field}
            type="password"
            name="password"
            autoComplete={
              mode === "signin" ? "current-password" : "new-password"
            }
            minLength={mode === "signup" ? 8 : undefined}
            required
          />
        </label>

        {state.error && (
          <p className="text-[12px] text-down">{state.error}</p>
        )}
        {state.notice && (
          <p className="text-[12px] text-up">{state.notice}</p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-1 bg-acc/90 hover:bg-acc text-bg font-mono text-[11px] tracking-[0.1em] rounded px-3 py-2.5 transition-colors disabled:opacity-50"
        >
          {pending
            ? "…"
            : mode === "signin"
              ? "SIGN IN"
              : "CREATE ACCOUNT"}
        </button>
      </form>

      <p className="mt-5 text-[11px] text-dim leading-relaxed">
        A public account gives you the curated dashboard. Elevated access
        (read-only backoffice, operational control) is granted out of band.
      </p>
    </div>
  );
}
