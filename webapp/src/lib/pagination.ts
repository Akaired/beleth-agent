/**
 * How many rows a paginated view shows.
 *
 * These were three names across four files — `PAGE_SIZE`, `HISTORY_PAGE_SIZE`,
 * `TOPICS_PER_PAGE` — plus two anonymous defaults written straight into a query
 * signature, one of which silently repeated a value declared elsewhere. Naming them
 * together makes the differences deliberate: a decision row is one line, a position is
 * a card, so they do not want the same number.
 *
 * Client-safe: no `server-only`.
 */

/** Decision history — one compact row each. */
export const DECISIONS_PAGE_SIZE = 50;

/** Agent event log — one compact row each. */
export const LOGS_PAGE_SIZE = 40;

/** Position history — a wider row with leg detail. */
export const POSITIONS_PAGE_SIZE = 20;

/** Forum topic lists, public and in the admin moderation table. */
export const FORUM_PAGE_SIZE = 20;
