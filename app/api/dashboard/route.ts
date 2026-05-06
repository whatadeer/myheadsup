import { after, NextResponse } from "next/server";
import { buildSourceDashboardCacheKey } from "@/lib/dashboard-cache";
import { loadBaseSourceDashboard } from "@/lib/dashboard";
import {
  isDashboardSnapshotStale,
  summarizeDashboardSnapshots,
} from "@/lib/dashboard-snapshot";
import { readDashboardSnapshotEntries, writeDashboardSnapshot } from "@/lib/dashboard-snapshot-store";
import { getGitLabConfigError } from "@/lib/gitlab";
import { runWithRequestContext } from "@/lib/request-context";
import { parseRuntimeConfigValue } from "@/lib/runtime-config";
import { logServerDebug, logServerError } from "@/lib/server-log";
import {
  materializeSourceDashboard,
  type BaseSourceDashboard,
} from "@/lib/source-dashboard";
import { readSources } from "@/lib/store";
import type {
  DashboardResponsePayload,
  RuntimeConfig,
  SavedSource,
  SourceDashboard,
} from "@/lib/types";

export const dynamic = "force-dynamic";

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
  return runWithRequestContext(request.headers, async () => {
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
        return NextResponse.json({ message: configError }, { status: 503 });
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
  });
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
