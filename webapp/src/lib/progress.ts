/**
 * The experience ladder for signed-in users. Pure data + math, safe to import
 * from Client Components. The raw counters live in `public.user_progress`
 * (db/migrations/0015); this file turns an XP total into a level, an esoteric
 * title, and the progress toward the next rung.
 *
 * XP is earned two ways (both enforced server-side by SECURITY DEFINER RPCs):
 *   - the first dashboard load of a UTC day: +10, plus a streak bonus of
 *     min(streak, 7) × 2 for consecutive days.
 *   - each message sent to Beleth in chat: +3, capped at 10 messages/day.
 */

export type ProgressRow = {
  xp: number;
  streak_days: number;
  last_login_on: string | null;
  chat_xp_on: string | null;
  chat_msgs_today: number;
};

export type Rank = {
  level: number;
  title: string;
  /** Cumulative XP required to hold this rank. */
  minXp: number;
};

/**
 * Eleven ranks, deliberately esoteric — the arc of an initiate rising through a
 * hermetic order. Titles stay in English (the whole repo is English) but read
 * as the Italian brief asked: apprendista → accolito → …
 */
export const RANKS: readonly Rank[] = [
  { level: 1, title: "Neophyte", minXp: 0 },
  { level: 2, title: "Apprentice", minXp: 100 },
  { level: 3, title: "Acolyte", minXp: 250 },
  { level: 4, title: "Initiate", minXp: 500 },
  { level: 5, title: "Adept", minXp: 900 },
  { level: 6, title: "Occultist", minXp: 1400 },
  { level: 7, title: "Conjurer", minXp: 2100 },
  { level: 8, title: "Magister", minXp: 3000 },
  { level: 9, title: "Hierophant", minXp: 4200 },
  { level: 10, title: "Hierarch", minXp: 6000 },
  { level: 11, title: "Oracle of Beleth", minXp: 9000 },
] as const;

export type LevelInfo = {
  xp: number;
  rank: Rank;
  /** The next rank, or null when the ladder is maxed. */
  next: Rank | null;
  /** XP still needed to reach `next` (0 when maxed). */
  xpToNext: number;
  /** 0..1 fill of the bar between `rank.minXp` and `next.minXp` (1 when maxed). */
  fraction: number;
  /** XP accumulated inside the current band. */
  xpIntoRank: number;
  /** Width of the current band (next.minXp - rank.minXp), 0 when maxed. */
  bandXp: number;
};

export function levelForXp(rawXp: number | null | undefined): LevelInfo {
  const xp = Math.max(0, Math.floor(rawXp ?? 0));

  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) {
    if (xp >= RANKS[i].minXp) idx = i;
    else break;
  }
  const rank = RANKS[idx];
  const next = idx + 1 < RANKS.length ? RANKS[idx + 1] : null;

  if (!next) {
    return {
      xp,
      rank,
      next: null,
      xpToNext: 0,
      fraction: 1,
      xpIntoRank: xp - rank.minXp,
      bandXp: 0,
    };
  }

  const bandXp = next.minXp - rank.minXp;
  const xpIntoRank = xp - rank.minXp;
  return {
    xp,
    rank,
    next,
    xpToNext: next.minXp - xp,
    fraction: Math.min(1, Math.max(0, xpIntoRank / bandXp)),
    xpIntoRank,
    bandXp,
  };
}

/** "Neophyte" → the rank a fresh account starts at. */
export const BASE_RANK: Rank = RANKS[0];
