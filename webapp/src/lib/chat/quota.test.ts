/**
 * The per-account chat ceiling exists to protect one shared free-tier key. These pin
 * the two things that would quietly break it: the wrong day boundary, and a failing
 * count turning into a refusal.
 */
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { startOfUtcDay, userTurnsUsedToday } from "@/lib/chat/quota";

function fakeSupabase(result: { count?: number | null; error?: unknown }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    gte: vi.fn(() => Promise.resolve(result)),
  };
  return { from: vi.fn(() => chain) } as unknown as SupabaseClient;
}

describe("startOfUtcDay", () => {
  it("is midnight UTC of the given instant, not of local time", () => {
    expect(startOfUtcDay(new Date("2026-09-02T23:30:00Z"))).toBe("2026-09-02T00:00:00.000Z");
    expect(startOfUtcDay(new Date("2026-09-03T00:00:01Z"))).toBe("2026-09-03T00:00:00.000Z");
  });
});

describe("userTurnsUsedToday", () => {
  it("returns the counted turns", async () => {
    const used = await userTurnsUsedToday(fakeSupabase({ count: 7 }), "u1");
    expect(used).toBe(7);
  });

  it("treats a null count as zero", async () => {
    expect(await userTurnsUsedToday(fakeSupabase({ count: null }), "u1")).toBe(0);
  });

  it("does not refuse a user over a transient database error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await userTurnsUsedToday(fakeSupabase({ error: { message: "boom" } }), "u1")).toBe(0);
    spy.mockRestore();
  });
});
