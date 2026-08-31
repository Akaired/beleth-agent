"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Keeps a server-rendered page in sync with reality without a manual reload.
 *
 * Two independent triggers, both calling a debounced `router.refresh()` (which
 * re-runs the server components and streams a fresh RSC payload without
 * dropping client state):
 *
 *  1. **Supabase Realtime** — a Postgres change on any table the agent writes
 *     (`decisions` / `trades` / `positions` / `agent_status` / `risk_checks`)
 *     pushes an event and the page re-renders within a second. Read access is
 *     already governed by the anon SELECT policies (migration 0003); the tables
 *     are added to the `supabase_realtime` publication in migration 0027.
 *  2. **A slow interval poll** — covers the Alpaca-derived panels (equity
 *     curve, MARKET chip, order markers) that never touch Postgres, plus any
 *     Realtime gap (reconnect, missed event, publication not yet applied).
 *
 * Pauses while the tab is hidden, and refreshes once on the way back to
 * visible, so a backgrounded dashboard costs nothing.
 */
const WATCHED_TABLES = [
  "decisions",
  "trades",
  "positions",
  "agent_status",
  "risk_checks",
] as const;

const DEFAULT_POLL_MS = 30_000;
const DEBOUNCE_MS = 400;

export function LiveRefresh({ pollMs = DEFAULT_POLL_MS }: { pollMs?: number }) {
  const router = useRouter();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const refresh = () => {
      if (document.hidden) return;
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => router.refresh(), DEBOUNCE_MS);
    };

    // 1. Realtime — best effort. A missing anon key or a project without the
    //    publication applied just falls through to the poll below.
    let supabase: ReturnType<typeof createClient> | null = null;
    try {
      supabase = createClient();
    } catch {
      supabase = null;
    }
    const channel = supabase?.channel("beleth-live") ?? null;
    if (channel) {
      for (const table of WATCHED_TABLES) {
        channel.on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          refresh,
        );
      }
      channel.subscribe();
    }

    // 2. Poll.
    const interval = setInterval(refresh, pollMs);

    // 3. Catch up the moment the tab is foregrounded again.
    const onVisibility = () => {
      if (!document.hidden) refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (debounce.current) clearTimeout(debounce.current);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      if (channel) void channel.unsubscribe();
    };
  }, [router, pollMs]);

  return null;
}
