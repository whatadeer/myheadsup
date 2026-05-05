import type { DashboardSnapshotSummary } from "./types";

export const sourceDashboardSnapshotTtlMs = 60 * 60 * 1000;

type DashboardSnapshotSummaryEntry = {
  fetchedAt: string | null;
  isRefreshing: boolean;
};

export function summarizeDashboardSnapshots<T extends DashboardSnapshotSummaryEntry>(
  dashboards: T[],
  now = Date.now(),
): DashboardSnapshotSummary {
  const freshSourceCount = dashboards.filter(
    (entry) => entry.fetchedAt && !isDashboardSnapshotStale(entry.fetchedAt, now),
  ).length;
  const staleSourceCount = dashboards.filter(
    (entry) => entry.fetchedAt && isDashboardSnapshotStale(entry.fetchedAt, now),
  ).length;
  const refreshingSourceCount = dashboards.filter((entry) => entry.isRefreshing).length;
  const missingSourceCount = dashboards.filter((entry) => !entry.fetchedAt).length;
  const lastUpdatedAt =
    dashboards
      .map((entry) => entry.fetchedAt)
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => left.localeCompare(right))
      .at(-1) ?? null;

  let status: DashboardSnapshotSummary["status"] = "empty";
  if (dashboards.length > 0 && missingSourceCount < dashboards.length) {
    status =
      refreshingSourceCount > 0
        ? "refreshing"
        : staleSourceCount > 0
          ? "stale"
          : "fresh";
  }

  return {
    status,
    lastUpdatedAt,
    freshSourceCount,
    staleSourceCount,
    refreshingSourceCount,
    missingSourceCount,
  };
}

export function isDashboardSnapshotStale(fetchedAt: string, now = Date.now()) {
  const parsed = Date.parse(fetchedAt);
  if (!Number.isFinite(parsed)) {
    return true;
  }

  return now - parsed >= sourceDashboardSnapshotTtlMs;
}
