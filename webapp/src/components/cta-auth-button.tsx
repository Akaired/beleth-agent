"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { hasSupabaseAuthCookie } from "@/lib/supabase/auth-cookie";
import { IconSignIn, IconArrowUpRight } from "@/components/icons";

/**
 * The primary CTA button in the homepage footer section. A client island so
 * the page stays statically cached: it renders the "Log in / Register" link
 * hidden until auth resolves, then shows "Dashboard" for a signed-in visitor.
 */
export function CtaAuthButton({ className }: { className: string }) {
  const [status, setStatus] = useState<"unknown" | "in" | "out">("unknown");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setStatus(hasSupabaseAuthCookie() ? "in" : "out");

      const {
        data: { user },
      } = await createClient().auth.getUser();
      if (!cancelled) setStatus(user ? "in" : "out");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "in") {
    return (
      <Link href="/dashboard" className={className}>
        <IconArrowUpRight size={15} weight="fill" />
        Dashboard
      </Link>
    );
  }

  return (
    <Link
      href="/login"
      aria-hidden={status === "unknown"}
      className={`${className} ${status === "unknown" ? "invisible" : ""}`}
    >
      <IconSignIn size={15} weight="fill" />
      Log in / Register
    </Link>
  );
}
