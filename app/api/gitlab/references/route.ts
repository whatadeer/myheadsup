import { NextResponse } from "next/server";
import { getGitLabConfigError, searchSourceSuggestions } from "@/lib/gitlab";
import { runWithRequestContext } from "@/lib/request-context";
import { parseRuntimeConfigValue } from "@/lib/runtime-config";
import { logServerDebug, logServerError } from "@/lib/server-log";
import type { SourceKind } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return runWithRequestContext(request.headers, async () => {
    const { searchParams } = new URL(request.url);
    return handleLookup({
      kind: searchParams.get("kind"),
      query: searchParams.get("q") ?? "",
    });
  });
}

export async function POST(request: Request) {
  return runWithRequestContext(request.headers, async () => {
    try {
      const payload = (await request.json()) as {
        kind?: string | null;
        q?: string;
        runtimeConfig?: unknown;
      };

      return handleLookup({
        kind: payload.kind ?? null,
        query: payload.q ?? "",
        runtimeConfig: parseRuntimeConfigValue(payload.runtimeConfig),
      });
    } catch (error) {
      logServerError("api-gitlab-references", error);
      return NextResponse.json({ message: "Invalid request body." }, { status: 400 });
    }
  });
}

async function handleLookup({
  kind,
  query,
  runtimeConfig,
}: {
  kind: string | null;
  query: string;
  runtimeConfig?: Parameters<typeof getGitLabConfigError>[0];
}) {
  if (kind && !isSourceKind(kind)) {
    return NextResponse.json({ message: "Invalid source type." }, { status: 400 });
  }

  const configError = getGitLabConfigError(runtimeConfig);

  if (configError) {
    return NextResponse.json({ message: configError }, { status: 503 });
  }

  try {
    const parsedKind = isSourceKind(kind) ? kind : undefined;
    logServerDebug("api-gitlab-references", "Loading suggestions", {
      kind: parsedKind ?? "all",
      queryLength: query.trim().length,
      usesRuntimeConfig: Boolean(runtimeConfig),
    });
    const suggestions = await searchSourceSuggestions(query, parsedKind, runtimeConfig);
    return NextResponse.json({ suggestions });
  } catch (error) {
    logServerError("api-gitlab-references", error, {
      kind: kind ?? "all",
      query,
      usesRuntimeConfig: Boolean(runtimeConfig),
    });
    return NextResponse.json(
      {
        message:
          error instanceof Error ? error.message : "Unable to load GitLab suggestions.",
      },
      { status: 500 },
    );
  }
}

function isSourceKind(value: string | null): value is SourceKind {
  return value === "group" || value === "project";
}
