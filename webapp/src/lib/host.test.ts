/**
 * `latestHostMetrics` replaced `parseHostMetrics`, which read the snapshot out of
 * `agent_status.detail` — a row anonymous readers can read, carrying the machine's
 * name and kernel. These pin the replacement's edges.
 */
import { describe, expect, it } from "vitest";
import { latestHostMetrics, type HostHistoryPoint } from "@/lib/host";

const point = (capturedAt: string, label: string): HostHistoryPoint =>
  ({ captured_at: capturedAt, metrics: { label } }) as unknown as HostHistoryPoint;

describe("latestHostMetrics", () => {
  it("takes the newest point of an ascending history", () => {
    const history = [point("2026-09-01T10:00:00Z", "old"), point("2026-09-01T11:00:00Z", "new")];
    expect(latestHostMetrics(history)?.label).toBe("new");
  });

  it("returns null rather than throwing when there is no history at all", () => {
    expect(latestHostMetrics([])).toBeNull();
    expect(latestHostMetrics(null)).toBeNull();
    expect(latestHostMetrics(undefined)).toBeNull();
  });

  it("falls back to the row's captured_at when the snapshot has none", () => {
    expect(latestHostMetrics([point("2026-09-01T11:00:00Z", "x")])?.captured_at).toBe(
      "2026-09-01T11:00:00Z",
    );
  });

  it("survives a row whose metrics column is not an object", () => {
    const broken = [{ captured_at: "2026-09-01T11:00:00Z", metrics: null }];
    expect(latestHostMetrics(broken as unknown as HostHistoryPoint[])).toBeNull();
  });
});
