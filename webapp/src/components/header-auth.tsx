"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { hasSupabaseAuthCookie } from "@/lib/supabase/auth-cookie";
import type { Role } from "@/lib/roles";
import { AccountDropdown } from "@/components/account-dropdown";
import { IconSignIn } from "@/components/icons";

type AuthState =
  | { status: "unknown" }
  | { status: "out" }
  | {
      status: "in";
      email: string | null;
      role: Role;
      displayName: string | null;
      avatarUrl: string | null;
    };

const ROLE_KEY = "beleth-account-role";
const NAME_KEY = "beleth-account-name";
/**
 * Written by an earlier version of this component. `localStorage` outlives a sign-out
 * that does not pass through `clearCache()` — a server-side redirect, a session that
 * simply expires — so on a shared browser the next visitor saw the previous account's
 * address until `getUser()` came back. The email is display-only; it is no longer
 * cached, and this key is removed on sight.
 */
const LEGACY_EMAIL_KEY = "beleth-account-email";
const AVATAR_KEY = "beleth-account-avatar";
const ROLES: Role[] = ["public_user", "demo_admin", "master_admin"];

function readCache(): {
  role: Role;
  displayName: string | null;
  avatarUrl: string | null;
} {
  try {
    localStorage.removeItem(LEGACY_EMAIL_KEY);
    const cached = localStorage.getItem(ROLE_KEY) as Role | null;
    const role = cached && ROLES.includes(cached) ? cached : "public_user";
    return {
      role,
      displayName: localStorage.getItem(NAME_KEY),
      avatarUrl: localStorage.getItem(AVATAR_KEY),
    };
  } catch {
    return { role: "public_user", displayName: null, avatarUrl: null };
  }
}

function writeCache(role: Role, displayName: string | null, avatarUrl: string | null) {
  try {
    localStorage.setItem(ROLE_KEY, role);
    if (displayName) localStorage.setItem(NAME_KEY, displayName);
    else localStorage.removeItem(NAME_KEY);
    if (avatarUrl) localStorage.setItem(AVATAR_KEY, avatarUrl);
    else localStorage.removeItem(AVATAR_KEY);
  } catch {
    /* private mode — the network path still corrects the UI */
  }
}

function clearCache() {
  try {
    for (const k of [ROLE_KEY, LEGACY_EMAIL_KEY, NAME_KEY, AVATAR_KEY]) {
      localStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Auth-aware right cluster of the public header. A client island so the
 * homepage stays statically cached (ISR). The server always renders the
 * "Log in / Register" link but hidden (`invisible`) — so a signed-in visitor
 * never sees it flash. The first client effect resolves the real state from
 * the auth cookie (+ a small local cache for name/role/avatar) almost instantly;
 * `getUser()` then confirms it and supplies the email.
 *
 * The cache deliberately holds no email. `localStorage` outlives a sign-out that does
 * not pass through `clearCache()`, and a display name on a shared browser is a much
 * smaller thing to leak than an address.
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
      if (hasSupabaseAuthCookie()) {
        // No email in the fast pass: it is not cached. `getUser()` fills it in below.
        const { role, displayName, avatarUrl } = readCache();
        setState({ status: "in", email: null, role, displayName, avatarUrl });
      } else {
        clearCache();
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
        .select("role, display_name, avatar_url")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const role = (profile?.role as Role | undefined) ?? "public_user";
      const email = user.email ?? null;
      const displayName = (profile?.display_name as string | null) ?? null;
      const avatarUrl = (profile?.avatar_url as string | null) ?? null;
      writeCache(role, displayName, avatarUrl);
      setState({ status: "in", email, role, displayName, avatarUrl });
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
        displayName={state.displayName}
        avatarUrl={state.avatarUrl}
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
