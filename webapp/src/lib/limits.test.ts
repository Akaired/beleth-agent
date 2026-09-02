/**
 * These constants are the app-side half of a limit the database also enforces. The
 * tests exist to pin the numbers against their migrations: a value looser here than in
 * Postgres shows the user a raw vendor error, and one that is tighter is a rule nothing
 * else knows about.
 */
import { describe, expect, it } from "vitest";
import {
  AVATAR_MAX_BYTES,
  BIO_MAX,
  IMAGE_MIME_TYPES,
  MEDIA_MAX_BYTES,
  NICKNAME_MAX,
  NICKNAME_MIN,
  describeMaxBytes,
} from "@/lib/limits";

describe("storage limits", () => {
  it("matches storage.buckets.file_size_limit", () => {
    // db/migrations/0014 — avatars: 2097152
    expect(AVATAR_MAX_BYTES).toBe(2_097_152);
    // db/migrations/0010 and 0018 — forum-media / docs-media: 5242880
    expect(MEDIA_MAX_BYTES).toBe(5_242_880);
  });

  it("matches allowed_mime_types on all three buckets", () => {
    expect([...IMAGE_MIME_TYPES]).toEqual([
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
    ]);
  });
});

describe("profile limits", () => {
  it("matches the profiles CHECK constraints", () => {
    // profiles_display_name_len: between 2 and 40
    expect([NICKNAME_MIN, NICKNAME_MAX]).toEqual([2, 40]);
    // profiles_bio_len: <= 280
    expect(BIO_MAX).toBe(280);
  });
});

describe("describeMaxBytes", () => {
  it("renders the limit the way the copy does", () => {
    expect(describeMaxBytes(AVATAR_MAX_BYTES)).toBe("2 MB");
    expect(describeMaxBytes(MEDIA_MAX_BYTES)).toBe("5 MB");
  });
});
