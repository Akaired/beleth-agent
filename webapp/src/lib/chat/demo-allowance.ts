/**
 * How many chat turns one visitor gets on the shared demo login.
 *
 * The demo account is public — the homepage signs anyone into it with a click —
 * so a per-account counter would let the first visitor of the day spend everyone
 * else's allowance, and the free model behind the chat has a small daily quota.
 * The count therefore lives in an httpOnly cookie: it is per browser, resets at
 * UTC midnight, and each visitor gets their own handful of questions.
 *
 * This is a product limit, not a security boundary. Clearing cookies resets it,
 * exactly as clearing them resets any signed-out allowance. The boundary that
 * matters — what the demo account may write at all — is in the database
 * (db/migrations/0030_demo_may_post_not_destroy.sql).
 */
import "server-only";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { DEMO_DAILY_MESSAGES } from "@/lib/chat/demo-allowance-limits";

export { DEMO_DAILY_MESSAGES } from "@/lib/chat/demo-allowance-limits";

/** Shown when the allowance is spent; the client turns it into a sign-up prompt. */
export const DEMO_CHAT_EXHAUSTED =
  `The demo account is limited to ${DEMO_DAILY_MESSAGES} messages a day. ` +
  "Register a free account to keep talking to Beleth.";

const COOKIE = "beleth-demo-chat";
/** A day, so the allowance survives a page reload but resets tomorrow. */
const MAX_AGE = 60 * 60 * 24;

/** UTC, to line up with the day boundary the XP counters already use. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Turns already spent by this browser today. */
export async function demoTurnsUsed(): Promise<number> {
  const raw = (await cookies()).get(COOKIE)?.value ?? "";
  const [day, count] = raw.split(":");
  if (day !== today()) return 0;
  const n = Number.parseInt(count ?? "", 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, DEMO_DAILY_MESSAGES) : 0;
}

export async function demoTurnsLeft(): Promise<number> {
  return DEMO_DAILY_MESSAGES - (await demoTurnsUsed());
}

/**
 * Record one spent turn on the outgoing response. Called only after a turn has
 * actually produced an answer, so a model outage costs the visitor nothing.
 */
export function spendDemoTurn(res: NextResponse, used: number): void {
  res.cookies.set(COOKIE, `${today()}:${used + 1}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}
