import { NextResponse } from "next/server";
import { getGitLabConfigError, playPipelineSchedule } from "@/lib/gitlab";
import { parseRuntimeConfigValue } from "@/lib/runtime-config";
import { logServerDebug, logServerError } from "@/lib/server-log";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      projectId?: unknown;
      runtimeConfig?: unknown;
      scheduleId?: unknown;
    };
    const runtimeConfig = parseRuntimeConfigValue(payload.runtimeConfig);
    const configError = getGitLabConfigError(runtimeConfig);

    if (configError) {
      return NextResponse.json({ message: configError }, { status: 503 });
    }

    const projectId = typeof payload.projectId === "number" ? payload.projectId : Number(payload.projectId);
    const scheduleId = typeof payload.scheduleId === "number" ? payload.scheduleId : Number(payload.scheduleId);

    if (!Number.isInteger(projectId) || projectId <= 0 || !Number.isInteger(scheduleId) || scheduleId <= 0) {
      return NextResponse.json({ message: "Invalid schedule request." }, { status: 400 });
    }

    logServerDebug("api-gitlab-schedule-play", "Triggering pipeline schedule", {
      projectId,
      scheduleId,
      usesRuntimeConfig: Boolean(runtimeConfig),
    });

    await playPipelineSchedule(projectId, scheduleId, runtimeConfig);
    return NextResponse.json({ message: "Pipeline schedule triggered." });
  } catch (error) {
    logServerError("api-gitlab-schedule-play", error);
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Unable to trigger the pipeline schedule.",
      },
      { status: 500 },
    );
  }
}
