"use client";

import { useTransition, useState } from "react";
import {
  reactivateAccountAction,
  signOutAction,
} from "@/app/account-deactivated/actions";

export function DeactivatedActions() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function reactivate() {
    setError(null);
    startTransition(async () => {
      const res = await reactivateAccountAction();
      // A success redirects server-side; only a failure returns here.
      if (res && !res.ok) setError(res.error);
    });
  }

  return (
    <div className="mt-6 flex flex-col gap-3">
      <button
        type="button"
        onClick={reactivate}
        disabled={pending}
        className="w-full rounded bg-acc px-4 py-2.5 font-mono text-[11px] font-medium tracking-[0.1em] text-bg transition-colors hover:bg-acc/90 disabled:opacity-50"
      >
        {pending ? "…" : "REACTIVATE ACCOUNT"}
      </button>

      {error && <p className="text-[12px] text-down">{error}</p>}

      <form action={signOutAction}>
        <button
          type="submit"
          className="w-full text-[12px] text-sec transition-colors hover:text-txt"
        >
          Log out
        </button>
      </form>
    </div>
  );
}
