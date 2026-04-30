import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { loadSourceDashboards } from "@/lib/dashboard";
import { getGitLabConfigError } from "@/lib/gitlab";
import { parseRuntimeConfigValue } from "@/lib/runtime-config";
import { logServerDebug, logServerError } from "@/lib/server-log";
import { readSources } from "@/lib/store";
import type { RuntimeConfig, SavedSource, SourceDashboard } from "@/lib/types";

export const dynamic = "force-dynamic";

const dashboardCacheTtlMs = 30_000;
const dashboardResponseCache = new Map<
  string,
  { expiresAt: number; dashboards: SourceDashboard[] }
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
    const cacheKey = buildDashboardCacheKey(savedSources, runtimeConfig);
    const cachedDashboards = !force ? readCachedDashboards(cacheKey) : null;

    if (cachedDashboards) {
      logServerDebug("api-dashboard", "Serving cached dashboard payload", {
        sourceCount: savedSources.length,
        usesRuntimeConfig: Boolean(runtimeConfig),
      });
      return NextResponse.json({ dashboards: cachedDashboards });
    }

    logServerDebug("api-dashboard", "Loading dashboard payload", {
      force,
      sourceCount: savedSources.length,
      usesRuntimeConfig: Boolean(runtimeConfig),
    });
    const dashboards = await loadSourceDashboards(savedSources, runtimeConfig);
    writeCachedDashboards(cacheKey, dashboards);
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

function buildDashboardCacheKey(
  savedSources: SavedSource[],
  runtimeConfig?: RuntimeConfig | null,
) {
  const payload = JSON.stringify({
    runtimeConfig: runtimeConfig ?? null,
    savedSources: savedSources.map((source) => ({
      gitlabId: source.gitlabId,
      id: source.id,
      kind: source.kind,
      projectSonarOverrides: source.projectSonarOverrides,
      query: source.query,
      sonarProjectKey: source.sonarProjectKey,
    })),
  });

  return createHash("sha256").update(payload).digest("hex");
}

function readCachedDashboards(cacheKey: string) {
  const entry = dashboardResponseCache.get(cacheKey);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    dashboardResponseCache.delete(cacheKey);
    return null;
  }

  return entry.dashboards;
}

function writeCachedDashboards(cacheKey: string, dashboards: SourceDashboard[]) {
  dashboardResponseCache.set(cacheKey, {
    dashboards,
    expiresAt: Date.now() + dashboardCacheTtlMs,
  });

  if (dashboardResponseCache.size <= 50) {
    return;
  }

  const oldestKey = dashboardResponseCache.keys().next().value;

  if (oldestKey) {
    dashboardResponseCache.delete(oldestKey);
  }
}
