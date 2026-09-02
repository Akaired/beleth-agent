"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { userFacingAuthError } from "@/lib/errors";
import { IconLock } from "@/components/icons";

const field =
  "w-full rounded bg-inset border border-inputline px-3.5 py-2.5 text-[13px] text-txt outline-none transition-colors placeholder:text-dim focus:border-hoverline";

export function UpdatePasswordForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = new FormData(e.currentTarget).get("password") as string;
    if (!password || password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setPending(true);
    setError(null);
    const { error } = await createClient().auth.updateUser({ password });
    setPending(false);
    if (error) {
      setError(userFacingAuthError(error, "Could not update your password."));
      return;
    }
    setDone(true);
    router.replace("/dashboard");
  }

  return (
    <div className="rounded-lg border border-line bg-panel p-7 sm:p-8">
      <h1 className="text-[24px] font-semibold tracking-[-0.01em]">
        Set a new password
      </h1>
      <p className="mt-1.5 text-[13px] leading-[1.55] text-sec">
        Open this page from the reset link in your email — it signs you in so
        you can choose a new password.
      </p>

      <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.1em] text-sec">
            <IconLock size={12} />
            NEW PASSWORD
          </span>
          <input
            className={field}
            type="password"
            name="password"
            placeholder="8+ characters"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </label>

        {error && <p className="text-[12px] text-down">{error}</p>}
        {done && (
          <p className="text-[12px] text-up">Password updated. Redirecting…</p>
        )}

        <button
          type="submit"
          disabled={pending || done}
          className="mt-1 rounded bg-acc px-4 py-2.5 font-mono text-[11px] font-medium tracking-[0.1em] text-bg transition-colors hover:bg-acc/90 disabled:opacity-50"
        >
          {pending ? "…" : "UPDATE PASSWORD"}
        </button>
      </form>
    </div>
  );
}
