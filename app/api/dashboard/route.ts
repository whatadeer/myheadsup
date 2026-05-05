import { createHash } from "node:crypto";
import { after, NextResponse } from "next/server";
import { loadBaseSourceDashboard } from "@/lib/dashboard";
import { readDashboardSnapshotEntries, writeDashboardSnapshot } from "@/lib/dashboard-snapshot-store";
import { getGitLabConfigError } from "@/lib/gitlab";
import { parseRuntimeConfigValue } from "@/lib/runtime-config";
import { resolveJiraBaseUrl } from "@/lib/server-jira";
import { logServerDebug, logServerError } from "@/lib/server-log";
import {
  materializeSourceDashboard,
  type BaseSourceDashboard,
} from "@/lib/source-dashboard";
import { readSources } from "@/lib/store";
import type {
  DashboardResponsePayload,
  DashboardSnapshotStatus,
  DashboardSnapshotSummary,
  RuntimeConfig,
  SavedSource,
  SourceDashboard,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const sourceDashboardSnapshotTtlMs = 30 * 60 * 1000;
const sourceDashboardRefreshCooldownMs = 30 * 1000;
const activeSourceDashboardRefreshes = new Map<string, Promise<SourceDashboardRefreshResult>>();
const recentSourceDashboardRefreshAttempts = new Map<string, number>();

type SourceDashboardRefreshResult = {
  baseDashboard: BaseSourceDashboard;
  fetchedAt: string | null;
};

type SourceDashboardSnapshotEntry = {
  baseDashboard: BaseSourceDashboard;
  fetchedAt: string;
};

type SourceDashboardResult = {
  dashboard: SourceDashboard;
  fetchedAt: string | null;
  isRefreshing: boolean;
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      force?: boolean;
      runtimeConfig?: unknown;
    };
    const force = payload.force === true;
    const runtimeConfig = parseRuntimeConfigValue(payload.runtimeConfig);
    const configError = getGitLabConfigError(runtimeConfig);

    if (configError) {
      logServerError("api-dashboard", new Error(configError), {
        hasRuntimeConfig: Boolean(runtimeConfig),
      });
      return NextResponse.json({ message: configError }, { status: 400 });
    }

    const savedSources = await readSources();
    const snapshots = await readDashboardSnapshotEntries();
    const dashboards = await Promise.all(
      savedSources.map((savedSource) =>
        loadSourceDashboard(savedSource, snapshots[buildSourceDashboardCacheKey(savedSource, runtimeConfig)] ?? null, runtimeConfig, force),
      ),
    );

    const response: DashboardResponsePayload = {
      dashboards: dashboards.map((entry) => entry.dashboard),
      snapshot: summarizeDashboardSnapshots(dashboards),
    };

    return NextResponse.json(response);
  } catch (error) {
    logServerError("api-dashboard", error);
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Unable to load saved source dashboards.",
      },
      { status: 500 },
    );
  }
}

async function loadSourceDashboard(
  savedSource: SavedSource,
  snapshot: SourceDashboardSnapshotEntry | null,
  runtimeConfig?: RuntimeConfig | null,
  force = false,
): Promise<SourceDashboardResult> {
  const cacheKey = buildSourceDashboardCacheKey(savedSource, runtimeConfig);
  const activeRefresh = activeSourceDashboardRefreshes.get(cacheKey);

  if (!snapshot) {
    logServerDebug("api-dashboard", "Loading source dashboard snapshot", {
      sourceId: savedSource.id,
      sourceKind: savedSource.kind,
      sourceGitLabId: savedSource.gitlabId,
      sourceSnapshotState: "missing",
      usesRuntimeConfig: Boolean(runtimeConfig),
    });

    const refreshResult = await waitForSourceDashboardRefresh(
      savedSource,
      runtimeConfig,
      cacheKey,
    );

    return {
      dashboard: materializeSourceDashboard(savedSource, refreshResult.baseDashboard),
      fetchedAt: refreshResult.fetchedAt,
      isRefreshing: false,
    };
  }

  if (activeRefresh) {
    logServerDebug("api-dashboard", "Serving saved dashboard snapshot", {
      force,
      sourceId: savedSource.id,
      sourceKind: savedSource.kind,
      sourceGitLabId: savedSource.gitlabId,
      sourceSnapshotState: "refreshing",
      usesRuntimeConfig: Boolean(runtimeConfig),
    });

    return {
      dashboard: materializeSourceDashboard(savedSource, snapshot.baseDashboard),
      fetchedAt: snapshot.fetchedAt,
      isRefreshing: true,
    };
  }

  const shouldRefreshInBackground =
    force ||
    (isDashboardSnapshotStale(snapshot.fetchedAt) &&
      !isSourceDashboardRefreshCoolingDown(cacheKey));
  if (shouldRefreshInBackground) {
    const refreshPromise = getOrStartSourceDashboardRefresh(savedSource, runtimeConfig, cacheKey);
    after(async () => {
      await refreshPromise;
    });

    logServerDebug("api-dashboard", "Serving saved dashboard snapshot", {
      force,
      sourceId: savedSource.id,
      sourceKind: savedSource.kind,
      sourceGitLabId: savedSource.gitlabId,
      sourceSnapshotState: force ? "forced-refresh" : "stale",
      usesRuntimeConfig: Boolean(runtimeConfig),
    });

    return {
      dashboard: materializeSourceDashboard(savedSource, snapshot.baseDashboard),
      fetchedAt: snapshot.fetchedAt,
      isRefreshing: true,
    };
  }

  logServerDebug("api-dashboard", "Serving saved dashboard snapshot", {
    sourceId: savedSource.id,
    sourceKind: savedSource.kind,
    sourceGitLabId: savedSource.gitlabId,
    sourceSnapshotState: "fresh",
    usesRuntimeConfig: Boolean(runtimeConfig),
  });

  return {
    dashboard: materializeSourceDashboard(savedSource, snapshot.baseDashboard),
    fetchedAt: snapshot.fetchedAt,
    isRefreshing: false,
  };
}

function buildSourceDashboardCacheKey(
  savedSource: SavedSource,
  runtimeConfig?: RuntimeConfig | null,
) {
  const payload = JSON.stringify({
    jiraBaseUrl: resolveJiraBaseUrl(runtimeConfig),
    runtimeConfig: runtimeConfig ?? null,
    source: {
      gitlabId: savedSource.gitlabId,
      jiraProjectKeys: savedSource.jiraProjectKeys,
      kind: savedSource.kind,
      projectJiraOverrides: savedSource.projectJiraOverrides,
      projectSonarOverrides: savedSource.projectSonarOverrides,
      sonarProjectKey: savedSource.sonarProjectKey,
    },
  });

  return createHash("sha256").update(payload).digest("hex");
}

function getOrStartSourceDashboardRefresh(
  savedSource: SavedSource,
  runtimeConfig: RuntimeConfig | null | undefined,
  cacheKey: string,
) {
  const activeRefresh = activeSourceDashboardRefreshes.get(cacheKey);
  if (activeRefresh) {
    return activeRefresh;
  }

  const refreshPromise = runSourceDashboardRefresh(savedSource, runtimeConfig, cacheKey)
    .catch((error) => {
      logServerError("api-dashboard", error, {
        sourceId: savedSource.id,
        sourceKind: savedSource.kind,
        sourceGitLabId: savedSource.gitlabId,
        usesRuntimeConfig: Boolean(runtimeConfig),
      });
      return {
        baseDashboard: {
          error: error instanceof Error ? error.message : "Unable to load this source.",
        },
        fetchedAt: null,
      } satisfies SourceDashboardRefreshResult;
    })
    .finally(() => {
      activeSourceDashboardRefreshes.delete(cacheKey);
    });

  activeSourceDashboardRefreshes.set(cacheKey, refreshPromise);
  return refreshPromise;
}

async function waitForSourceDashboardRefresh(
  savedSource: SavedSource,
  runtimeConfig: RuntimeConfig | null | undefined,
  cacheKey: string,
) {
  return getOrStartSourceDashboardRefresh(savedSource, runtimeConfig, cacheKey);
}

async function runSourceDashboardRefresh(
  savedSource: SavedSource,
  runtimeConfig: RuntimeConfig | null | undefined,
  cacheKey: string,
): Promise<SourceDashboardRefreshResult> {
  recentSourceDashboardRefreshAttempts.set(cacheKey, Date.now());

  logServerDebug("api-dashboard", "Refreshing source dashboard snapshot", {
    sourceId: savedSource.id,
    sourceKind: savedSource.kind,
    sourceGitLabId: savedSource.gitlabId,
    usesRuntimeConfig: Boolean(runtimeConfig),
  });

  const baseDashboard = await loadBaseSourceDashboard(savedSource, runtimeConfig);
  if ("error" in baseDashboard) {
    return {
      baseDashboard,
      fetchedAt: null,
    };
  }

  const fetchedAt = new Date().toISOString();
  await writeDashboardSnapshot(cacheKey, baseDashboard, fetchedAt);

  return {
    baseDashboard,
    fetchedAt,
  };
}

function summarizeDashboardSnapshots(
  dashboards: SourceDashboardResult[],
): DashboardSnapshotSummary {
  const freshSourceCount = dashboards.filter(
    (entry) => entry.fetchedAt && !isDashboardSnapshotStale(entry.fetchedAt),
  ).length;
  const staleSourceCount = dashboards.filter(
    (entry) => entry.fetchedAt && isDashboardSnapshotStale(entry.fetchedAt),
  ).length;
  const refreshingSourceCount = dashboards.filter((entry) => entry.isRefreshing).length;
  const missingSourceCount = dashboards.filter((entry) => !entry.fetchedAt).length;
  const lastUpdatedAt = dashboards
    .map((entry) => entry.fetchedAt)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => left.localeCompare(right))
    .at(-1) ?? null;

  let status: DashboardSnapshotStatus = "empty";
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

function isDashboardSnapshotStale(fetchedAt: string) {
  const parsed = Date.parse(fetchedAt);
  if (!Number.isFinite(parsed)) {
    return true;
  }

  return Date.now() - parsed >= sourceDashboardSnapshotTtlMs;
}

function isSourceDashboardRefreshCoolingDown(cacheKey: string) {
  const lastAttemptedAt = recentSourceDashboardRefreshAttempts.get(cacheKey);
  if (!lastAttemptedAt) {
    return false;
  }

  if (Date.now() - lastAttemptedAt >= sourceDashboardRefreshCooldownMs) {
    recentSourceDashboardRefreshAttempts.delete(cacheKey);
    return false;
  }

  return true;
}
