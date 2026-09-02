/**
 * Limits the webapp shares with the database, in one place.
 *
 * Each of these is enforced twice: once here so a form can refuse before a round trip,
 * and once in Postgres or Supabase Storage, which is the authority. They were typed out
 * separately — the avatar ceiling in three places, the nickname bounds in five — and a
 * pair that drifts apart is either a raw vendor error shown to a user (app looser than
 * the database) or a rule nothing else knows about (app tighter).
 *
 * **Change a value here and in the migration named beside it, in the same commit.**
 *
 * Client-safe: no `server-only`, the upload and profile components read it.
 * Forum body and title bounds live in `@/lib/forum/limits` next to their own migration.
 */

/** `storage.buckets.file_size_limit` for `avatars` — db/migrations/0014. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** `storage.buckets.file_size_limit` for `forum-media` and `docs-media` — 0010 / 0018. */
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;

/** `allowed_mime_types` on all three buckets. */
export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

/** The human phrasing of a size limit, so the copy cannot drift from the number. */
export function describeMaxBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** `profiles_display_name_len` — db/migrations/0014. */
export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 40;

/** `profiles_bio_len` — db/migrations/0014. */
export const BIO_MAX = 280;
