import { NextResponse } from "next/server";
import { buildSourceDashboardCacheKey } from "@/lib/dashboard-cache";
import { refreshSavedSourceProject } from "@/lib/dashboard";
import {
  readDashboardSnapshotEntries,
  writeDashboardSnapshot,
} from "@/lib/dashboard-snapshot-store";
import { getGitLabConfigError } from "@/lib/gitlab";
import { runWithRequestContext } from "@/lib/request-context";
import { logServerError } from "@/lib/server-log";
import { materializeSourceDashboard } from "@/lib/source-dashboard";
import { readSources } from "@/lib/store";
import { parseRuntimeConfigValue } from "@/lib/runtime-config";
import type { ProjectRefreshResponsePayload } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return runWithRequestContext(request.headers, async () => {
    try {
      const payload = (await request.json()) as {
        projectId?: unknown;
        runtimeConfig?: unknown;
        sourceId?: unknown;
      };

      if (typeof payload.sourceId !== "string" || !payload.sourceId) {
        return NextResponse.json({ message: "Missing saved source ID." }, { status: 400 });
      }

      const projectId =
        typeof payload.projectId === "number"
          ? payload.projectId
          : Number(payload.projectId);
      if (!Number.isInteger(projectId) || projectId <= 0) {
        return NextResponse.json({ message: "Invalid project reload request." }, { status: 400 });
      }

      const runtimeConfig = parseRuntimeConfigValue(payload.runtimeConfig);
      const configError = getGitLabConfigError(runtimeConfig);
      if (configError) {
        logServerError("api-dashboard-project", new Error(configError), {
          hasRuntimeConfig: Boolean(runtimeConfig),
        });
        return NextResponse.json({ message: configError }, { status: 503 });
      }

      const savedSource = (await readSources()).find(
        (source) => source.id === payload.sourceId,
      );
      if (!savedSource) {
        return NextResponse.json({ message: "That saved source no longer exists." }, { status: 404 });
      }

      const cacheKey = buildSourceDashboardCacheKey(savedSource, runtimeConfig);
      const snapshot = (await readDashboardSnapshotEntries())[cacheKey] ?? null;
      const baseDashboard = await refreshSavedSourceProject(
        savedSource,
        projectId,
        snapshot?.baseDashboard ?? null,
        runtimeConfig,
      );

      if ("error" in baseDashboard) {
        return NextResponse.json({ message: baseDashboard.error }, { status: 500 });
      }

      const fetchedAt = new Date().toISOString();
      await writeDashboardSnapshot(cacheKey, baseDashboard, fetchedAt);

      const response: ProjectRefreshResponsePayload = {
        dashboard: materializeSourceDashboard(savedSource, baseDashboard),
        message: "Project reloaded.",
      };
      return NextResponse.json(response);
    } catch (error) {
      logServerError("api-dashboard-project", error);
      return NextResponse.json(
        {
          message:
            error instanceof Error ? error.message : "Unable to reload that project.",
        },
        { status: 500 },
      );
    }
  });
}
