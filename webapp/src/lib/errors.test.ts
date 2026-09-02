/**
 * These pin the boundary the helper exists to hold: our own raised sentences reach the
 * visitor, and everything Postgres or a vendor says about the schema does not.
 */
import { describe, expect, it } from "vitest";
import {
  GENERIC_ERROR,
  userFacingAuthError,
  userFacingError,
} from "@/lib/errors";

describe("userFacingError", () => {
  it("passes through a message our own functions raised", () => {
    expect(
      userFacingError({ code: "42501", message: "The demo account is read-only." }),
    ).toBe("The demo account is read-only.");
    expect(
      userFacingError({ code: "22023", message: "title must be 3 to 120 characters" }),
    ).toBe("title must be 3 to 120 characters");
    // A bare `raise exception` in plpgsql.
    expect(
      userFacingError({ code: "P0001", message: "only master_admin may edit documentation" }),
    ).toBe("only master_admin may edit documentation");
  });

  it("hides a constraint or index name", () => {
    expect(
      userFacingError({
        code: "23505",
        message: 'duplicate key value violates unique constraint "forum_topics_slug_key"',
      }),
    ).toBe(GENERIC_ERROR);
    expect(
      userFacingError({
        code: "23514",
        message: 'new row violates check constraint "forum_posts_body_length"',
      }),
    ).toBe(GENERIC_ERROR);
  });

  it("hides a PostgREST or transport error", () => {
    expect(userFacingError({ code: "PGRST202", message: "No function matches..." })).toBe(
      GENERIC_ERROR,
    );
    expect(userFacingError({ message: "fetch failed" })).toBe(GENERIC_ERROR);
  });

  it("falls back on nothing to say", () => {
    expect(userFacingError(null)).toBe(GENERIC_ERROR);
    expect(userFacingError({ code: "42501", message: "   " })).toBe(GENERIC_ERROR);
  });

  it("refuses a long message even under a deliberate code", () => {
    expect(userFacingError({ code: "P0001", message: "x".repeat(400) })).toBe(GENERIC_ERROR);
  });

  it("uses the caller's own fallback when given one", () => {
    expect(userFacingError({ code: "23505", message: "..." }, "Try a different title.")).toBe(
      "Try a different title.",
    );
  });
});

describe("userFacingAuthError", () => {
  it("passes GoTrue's own copy through", () => {
    expect(userFacingAuthError({ message: "Invalid login credentials" })).toBe(
      "Invalid login credentials",
    );
  });

  it("falls back on an empty or implausibly long message", () => {
    expect(userFacingAuthError(null)).toBe("Could not sign you in. Please try again.");
    expect(userFacingAuthError({ message: "y".repeat(300) })).toBe(
      "Could not sign you in. Please try again.",
    );
  });
});
