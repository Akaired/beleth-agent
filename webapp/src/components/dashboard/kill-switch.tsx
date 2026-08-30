"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAgentPausedAction } from "@/app/dashboard/controls/actions";
import { IconPause, IconResume, IconWarning } from "@/components/icons";

/**
 * The one operational control the master-admin account has. Two-step: the
 * primary button arms a confirm/cancel pair, so the switch is never one
 * misplaced click away from flipping. Disabled while the server action runs.
 */
export function KillSwitch({ paused }: { paused: boolean }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const next = !paused;
  const verb = next ? "Pause" : "Resume";
  const VerbIcon = next ? IconPause : IconResume;

  function confirm() {
    setError(null);
    startTransition(async () => {
      const res = await setAgentPausedAction(next);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setArmed(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {paused ? (
          <IconWarning size={15} weight="fill" className="text-down" />
        ) : (
          <span className="inline-block h-2 w-2 rounded-full bg-up" />
        )}
        <span className="font-mono text-[12px] text-txt">
          {paused ? "PAUSED — kill switch engaged" : "RUNNING — kill switch clear"}
        </span>
      </div>

      <p className="text-[12px] text-sec leading-relaxed max-w-prose">
        {next
          ? "Stops new decisions from the next cycle. Heartbeat and resting orders are untouched — nothing is cancelled."
          : "The next cycle resumes normal evaluation."}
      </p>

      {!armed ? (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setArmed(true);
          }}
          className={`flex w-fit items-center gap-1.5 rounded border px-3 py-1.5 font-mono text-[12px] uppercase tracking-[0.06em] transition-colors ${
            next
              ? "border-killline text-down hover:bg-blocked/20"
              : "border-emphline text-up hover:bg-up/10"
          }`}
        >
          <VerbIcon size={13} weight="bold" />
          {verb} the agent
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className={`font-mono text-[12px] tracking-[0.06em] uppercase rounded px-3 py-1.5 border transition-colors disabled:opacity-50 ${
              next
                ? "border-killline bg-blocked/25 text-down hover:bg-blocked/40"
                : "border-emphline bg-up/15 text-up hover:bg-up/25"
            }`}
          >
            {pending ? "Working…" : `Confirm ${verb.toLowerCase()}`}
          </button>
          <button
            type="button"
            onClick={() => setArmed(false)}
            disabled={pending}
            className="font-mono text-[12px] tracking-[0.06em] uppercase rounded px-3 py-1.5 border border-line text-sec hover:text-txt transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <p className="font-mono text-[11px] text-down">{error}</p>
      )}
    </div>
  );
}
