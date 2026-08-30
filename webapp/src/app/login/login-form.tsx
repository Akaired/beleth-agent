"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import {
  resetPasswordAction,
  signInAction,
  signUpAction,
  type AuthState,
} from "@/app/login/actions";
import { createClient } from "@/lib/supabase/client";
import {
  IconArrowLeft,
  IconEnvelope,
  IconGoogle,
  IconLock,
} from "@/components/icons";

const field =
  "w-full rounded bg-inset border border-inputline px-3.5 py-2.5 text-[13px] text-txt outline-none transition-colors placeholder:text-dim focus:border-hoverline";

// Flip to true once the Google provider is enabled in Supabase and the
// callback URL is on the redirect allow list.
const GOOGLE_ENABLED = false;

type Mode = "signin" | "signup" | "reset";

export function LoginForm({
  next,
  initialMode = "signin",
  initialError = null,
}: {
  next: string;
  initialMode?: Mode;
  initialError?: string | null;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const action =
    mode === "signin"
      ? signInAction
      : mode === "signup"
        ? signUpAction
        : resetPasswordAction;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    action,
    { error: initialError, notice: null },
  );
  const [oauthPending, setOauthPending] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const signup = mode === "signup";
  const reset = mode === "reset";

  const heading = reset
    ? "Reset password"
    : signup
      ? "Create account"
      : "Log in";
  const subtitle = reset
    ? "We'll email you a link to set a new password."
    : signup
      ? "Set up an account to follow the agent from the dashboard."
      : "Welcome back to the agent's workspace.";

  async function continueWithGoogle() {
    setOauthPending(true);
    setOauthError(null);
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(
          next,
        )}`,
      },
    });
    if (error) {
      setOauthError(error.message);
      setOauthPending(false);
    }
  }

  return (
    <div className="rounded-lg border border-line bg-panel p-7 sm:p-8">
      <h1 className="text-[24px] font-semibold tracking-[-0.01em]">{heading}</h1>
      <p className="mt-1.5 text-[13px] leading-[1.55] text-sec">{subtitle}</p>

      {!reset && (
        <>
          <button
            type="button"
            onClick={continueWithGoogle}
            disabled={!GOOGLE_ENABLED || oauthPending}
            title={
              GOOGLE_ENABLED ? undefined : "Google sign-in is not enabled yet"
            }
            className="mt-7 flex w-full items-center justify-center gap-2.5 rounded border border-inputline bg-inset px-4 py-2.5 text-[13px] font-medium text-txt transition-colors hover:border-hoverline disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconGoogle size={16} weight="bold" />
            {oauthPending ? "Redirecting…" : "Continue with Google"}
            {!GOOGLE_ENABLED && (
              <span className="font-mono text-[9px] tracking-[0.1em] text-dim">
                SOON
              </span>
            )}
          </button>
          {oauthError && (
            <p className="mt-2 text-[12px] text-down">{oauthError}</p>
          )}
          <div className="my-6 flex items-center gap-3 font-mono text-[10px] tracking-[0.12em] text-dim">
            <span className="h-px flex-1 bg-line" />
            OR
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <form
        action={formAction}
        className={`flex flex-col gap-4 ${reset ? "mt-7" : ""}`}
      >
        <input type="hidden" name="next" value={next} />

        <label className="flex flex-col gap-1.5">
          <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.1em] text-sec">
            <IconEnvelope size={12} />
            EMAIL
          </span>
          <input
            className={field}
            type="email"
            name="email"
            placeholder="you@example.com"
            autoComplete="email"
            required
          />
        </label>

        {!reset && (
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between font-mono text-[10px] tracking-[0.1em] text-sec">
              <span className="flex items-center gap-1.5">
                <IconLock size={12} />
                PASSWORD
              </span>
              {mode === "signin" && (
                <button
                  type="button"
                  onClick={() => setMode("reset")}
                  className="tracking-[0.06em] text-acc transition-colors hover:text-txt"
                >
                  FORGOT?
                </button>
              )}
            </span>
            <input
              className={field}
              type="password"
              name="password"
              placeholder={signup ? "8+ characters" : "••••••••"}
              autoComplete={signup ? "new-password" : "current-password"}
              minLength={signup ? 8 : undefined}
              required
            />
          </label>
        )}

        {!reset && (
          <label className="flex items-center gap-2.5 text-[12.5px] text-sec select-none">
            <input
              type="checkbox"
              name="remember"
              className="size-4 accent-acc"
            />
            Remember me on this device
          </label>
        )}

        {state.error && <p className="text-[12px] text-down">{state.error}</p>}
        {state.notice && <p className="text-[12px] text-up">{state.notice}</p>}

        <div className="mt-1 flex items-center gap-2.5">
          {reset ? (
            <button
              type="button"
              onClick={() => setMode("signin")}
              aria-label="Back to log in"
              className="flex size-10 shrink-0 items-center justify-center rounded-full border border-line text-sec transition-colors hover:border-hoverline hover:text-txt"
            >
              <IconArrowLeft size={15} />
            </button>
          ) : (
            <Link
              href="/"
              aria-label="Back to homepage"
              className="flex size-10 shrink-0 items-center justify-center rounded-full border border-line text-sec transition-colors hover:border-hoverline hover:text-txt"
            >
              <IconArrowLeft size={15} />
            </Link>
          )}
          <button
            type="submit"
            disabled={pending}
            className="flex-1 rounded bg-acc px-4 py-2.5 font-mono text-[11px] font-medium tracking-[0.1em] text-bg transition-colors hover:bg-acc/90 disabled:opacity-50"
          >
            {pending
              ? "…"
              : reset
                ? "SEND RESET LINK"
                : signup
                  ? "CREATE ACCOUNT"
                  : "LOG IN"}
          </button>
        </div>
      </form>

      {!reset && (
        <p className="mt-6 border-t border-line pt-5 text-center text-[12.5px] text-sec">
          {signup ? "Already have an account? " : "Don't have an account? "}
          <button
            type="button"
            onClick={() => setMode(signup ? "signin" : "signup")}
            className="font-medium text-acc transition-colors hover:text-txt"
          >
            {signup ? "Log in" : "Sign up"}
          </button>
        </p>
      )}
    </div>
  );
}
