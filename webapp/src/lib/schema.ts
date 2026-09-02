/**
 * Names and shapes of the database this webapp reads, in one place.
 *
 * Storage bucket ids and the `agent_status` singleton key were spelled out at each
 * call site. They are not tunables — they are what `db/migrations/` created — but a
 * literal repeated across files is a rename waiting to be half-applied, and
 * `.eq("id", 1)` in four places says nothing about *why* the id is 1.
 *
 * Client-safe: no `server-only`.
 */

/** Public bucket for profile avatars — db/migrations/0014. */
export const AVATAR_BUCKET = "avatars";
/** Public bucket for images pasted into a forum post — db/migrations/0010. */
export const FORUM_MEDIA_BUCKET = "forum-media";
/** Public bucket for images in documentation pages — db/migrations/0018. */
export const DOCS_MEDIA_BUCKET = "docs-media";

/**
 * `agent_status` holds exactly one row. The agent upserts it every cycle at this id,
 * so the dashboard's "is it alive" read is a primary-key lookup rather than an
 * ordered scan — see db/migrations/0001 and app/persistence.agent_status_row.
 */
export const AGENT_STATUS_ID = 1;

/** The columns every `agent_status` read asks for. */
export const AGENT_STATUS_COLS = "state,paused,last_cycle_at,detail";
