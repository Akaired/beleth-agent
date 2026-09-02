/**
 * The forum's length limits, in one place, because they are enforced in three and used
 * to disagree.
 *
 * The database is the authority — `db/migrations/0032_forum_length_limits.sql` puts a
 * CHECK constraint on the columns, which is the only place the server action, the
 * `beleth_forum_*` functions and a direct PostgREST insert all pass through. These
 * constants exist so the form can say "too long" before a round trip, and so the
 * `maxLength` on an input is not a number typed twice.
 *
 * If you change one of these, change 0032 in the same commit. A limit that is looser
 * here than in the database is a raw Postgres error shown to a user; one that is
 * tighter is a rule nothing else knows about.
 *
 * Client-safe: no `server-only` import, the composer components read it.
 */

export const TITLE_MIN = 3;
export const TITLE_MAX = 120;
export const BODY_MAX = 100_000;
/** The per-post alias the shared demo account posts under. */
export const AUTHOR_NAME_MAX = 40;
