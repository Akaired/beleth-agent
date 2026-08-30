"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Role } from "@/lib/roles";
import { AccountDropdown } from "@/components/account-dropdown";
import { IconSignIn } from "@/components/icons";

type AuthState =
  | { status: "unknown" }
  | { status: "out" }
  | { status: "in"; email: string | null; role: Role };

const ROLE_KEY = "beleth-account-role";
const EMAIL_KEY = "beleth-account-email";
const ROLES: Role[] = ["public_user", "demo_admin", "master_admin"];

/**
 * Is a Supabase auth-token cookie present? `@supabase/ssr` does not mark it
 * httpOnly (the browser client needs to read it), so this is a synchronous,
 * network-free signal we can trust for the first render.
 */
function hasAuthCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split("; ")
    .some((c) => /^sb-[^=]*-auth-token(\.\d+)?=./.test(c));
}

function readCache(): { email: string | null; role: Role } {
  try {
    const cached = localStorage.getItem(ROLE_KEY) as Role | null;
    const role = cached && ROLES.includes(cached) ? cached : "public_user";
    return { email: localStorage.getItem(EMAIL_KEY), role };
  } catch {
    return { email: null, role: "public_user" };
  }
}

function writeCache(email: string | null, role: Role) {
  try {
    localStorage.setItem(ROLE_KEY, role);
    if (email) localStorage.setItem(EMAIL_KEY, email);
  } catch {
    /* private mode — the network path still corrects the UI */
  }
}

function clearCache() {
  try {
    localStorage.removeItem(ROLE_KEY);
    localStorage.removeItem(EMAIL_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Auth-aware right cluster of the public header. A client island so the
 * homepage stays statically cached (ISR). The server always renders the
 * "Log in / Register" link but hidden (`invisible`) — so a signed-in visitor
 * never sees it flash. The first client effect resolves the real state from
 * the auth cookie (+ a small local cache for name/role) almost instantly;
 * `getUser()` then confirms it.
 */
export function HeaderAuth() {
  const [state, setState] = useState<AuthState>({ status: "unknown" });

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    (async () => {
      // Fast, network-free first pass (kept off the synchronous effect body):
      // an auth cookie is enough to swap in the dropdown before getUser().
      await Promise.resolve();
      if (cancelled) return;
      if (hasAuthCookie()) {
        const { email, role } = readCache();
        setState({ status: "in", email, role });
      } else {
        setState({ status: "out" });
      }

      // Authoritative pass: validate the session and refresh name/role.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        clearCache();
        setState({ status: "out" });
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const role = (profile?.role as Role | undefined) ?? "public_user";
      const email = user.email ?? null;
      writeCache(email, role);
      setState({ status: "in", email, role });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "in") {
    return (
      <AccountDropdown
        role={state.role}
        email={state.email}
        homeHref="/dashboard"
        homeLabel="Dashboard"
        showNotifications={false}
      />
    );
  }

  return (
    <Link
      href="/login"
      aria-hidden={state.status === "unknown"}
      className={`inline-flex items-center gap-1.5 rounded-[2px] bg-txt px-3 py-[7px] text-[12px] font-medium text-bg transition-colors hover:bg-acc ${
        state.status === "unknown" ? "invisible" : ""
      }`}
    >
      <IconSignIn size={13} weight="fill" />
      Log in / Register
    </Link>
  );
}
