import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { loadBaseSourceDashboard } from "@/lib/dashboard";
import { getGitLabConfigError } from "@/lib/gitlab";
import { parseRuntimeConfigValue } from "@/lib/runtime-config";
import { resolveJiraBaseUrl } from "@/lib/server-jira";
import { logServerDebug, logServerError } from "@/lib/server-log";
import {
  materializeSourceDashboard,
  type BaseSourceDashboard,
} from "@/lib/source-dashboard";
import { readSources } from "@/lib/store";
import type { RuntimeConfig, SavedSource } from "@/lib/types";

export const dynamic = "force-dynamic";

const sourceDashboardCacheTtlMs = 30 * 60 * 1000;
const sourceDashboardCache = new Map<
  string,
  { expiresAt: number; baseDashboard: BaseSourceDashboard }
>();

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
    const dashboards = await Promise.all(
      savedSources.map((savedSource) =>
        loadSourceDashboard(savedSource, runtimeConfig, force),
      ),
    );

    return NextResponse.json({ dashboards });
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
  runtimeConfig?: RuntimeConfig | null,
  force = false,
) {
  const cacheKey = buildSourceDashboardCacheKey(savedSource, runtimeConfig);
  const cachedBaseDashboard = !force ? readCachedSourceDashboard(cacheKey) : null;

  if (cachedBaseDashboard) {
    logServerDebug("api-dashboard", "Serving cached source dashboard", {
      sourceId: savedSource.id,
      sourceKind: savedSource.kind,
      sourceGitLabId: savedSource.gitlabId,
      usesRuntimeConfig: Boolean(runtimeConfig),
    });
    return materializeSourceDashboard(savedSource, cachedBaseDashboard);
  }

  logServerDebug("api-dashboard", "Loading source dashboard", {
    force,
    sourceId: savedSource.id,
    sourceKind: savedSource.kind,
    sourceGitLabId: savedSource.gitlabId,
    usesRuntimeConfig: Boolean(runtimeConfig),
  });
  const baseDashboard = await loadBaseSourceDashboard(savedSource, runtimeConfig);

  if (!("error" in baseDashboard)) {
    writeCachedSourceDashboard(cacheKey, baseDashboard);
  }

  return materializeSourceDashboard(savedSource, baseDashboard);
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

function readCachedSourceDashboard(cacheKey: string) {
  const entry = sourceDashboardCache.get(cacheKey);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    sourceDashboardCache.delete(cacheKey);
    return null;
  }

  return entry.baseDashboard;
}

function writeCachedSourceDashboard(
  cacheKey: string,
  baseDashboard: BaseSourceDashboard,
) {
  sourceDashboardCache.set(cacheKey, {
    baseDashboard,
    expiresAt: Date.now() + sourceDashboardCacheTtlMs,
  });

  if (sourceDashboardCache.size <= 200) {
    return;
  }

  const oldestKey = sourceDashboardCache.keys().next().value;

  if (oldestKey) {
    sourceDashboardCache.delete(oldestKey);
  }
}
