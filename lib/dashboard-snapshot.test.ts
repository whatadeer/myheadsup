import { describe, expect, it } from "vitest";
import {
  isDashboardSnapshotStale,
  sourceDashboardSnapshotTtlMs,
  summarizeDashboardSnapshots,
} from "./dashboard-snapshot";

describe("dashboard snapshot helpers", () => {
  it("marks invalid or expired snapshots as stale", () => {
    const now = Date.parse("2026-05-05T20:00:00.000Z");
    const freshTimestamp = new Date(now - sourceDashboardSnapshotTtlMs + 1).toISOString();
    const staleTimestamp = new Date(now - sourceDashboardSnapshotTtlMs).toISOString();

    expect(isDashboardSnapshotStale("not-a-date", now)).toBe(true);
    expect(isDashboardSnapshotStale(staleTimestamp, now)).toBe(true);
    expect(isDashboardSnapshotStale(freshTimestamp, now)).toBe(false);
  });

  it("reports empty when every source is missing a snapshot", () => {
    expect(
      summarizeDashboardSnapshots([
        { fetchedAt: null, isRefreshing: false },
        { fetchedAt: null, isRefreshing: true },
      ]),
    ).toEqual({
      status: "empty",
      lastUpdatedAt: null,
      freshSourceCount: 0,
      staleSourceCount: 0,
      refreshingSourceCount: 1,
      missingSourceCount: 2,
    });
  });

  it("reports refreshing when cached data exists and a background refresh is running", () => {
    const now = Date.parse("2026-05-05T20:00:00.000Z");

    expect(
      summarizeDashboardSnapshots(
        [
          { fetchedAt: "2026-05-05T19:59:00.000Z", isRefreshing: true },
          { fetchedAt: "2026-05-05T19:58:30.000Z", isRefreshing: false },
          { fetchedAt: null, isRefreshing: false },
        ],
        now,
      ),
    ).toEqual({
      status: "refreshing",
      lastUpdatedAt: "2026-05-05T19:59:00.000Z",
      freshSourceCount: 2,
      staleSourceCount: 0,
      refreshingSourceCount: 1,
      missingSourceCount: 1,
    });
  });

  it("reports stale when the newest available snapshot is older than the ttl", () => {
    const now = Date.parse("2026-05-05T20:00:00.000Z");

    expect(
      summarizeDashboardSnapshots(
        [
          { fetchedAt: "2026-05-05T19:00:00.000Z", isRefreshing: false },
          { fetchedAt: "2026-05-05T18:45:00.000Z", isRefreshing: false },
        ],
        now,
      ),
    ).toEqual({
      status: "stale",
      lastUpdatedAt: "2026-05-05T19:00:00.000Z",
      freshSourceCount: 0,
      staleSourceCount: 2,
      refreshingSourceCount: 0,
      missingSourceCount: 0,
    });
  });
});
