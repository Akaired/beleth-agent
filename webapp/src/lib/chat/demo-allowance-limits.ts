/**
 * The demo chat allowance, split out from `demo-allowance.ts` so a Client
 * Component can read the number without pulling in `server-only` and
 * `next/headers`.
 */

/** Turns a demo visitor may take per day, per browser. */
export const DEMO_DAILY_MESSAGES = 4;
