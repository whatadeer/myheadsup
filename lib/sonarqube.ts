import { createConcurrencyLimiter } from "./concurrency-limit";
import { describeRequestError } from "./request-errors";
import { preferRuntimeValue } from "./runtime-config";
import { logServerError, logServerExternalRequest } from "./server-log";
import type { RuntimeConfig, SonarMetricHistoryPoint, SonarProjectSummary } from "./types";

type SonarQualityGateResponse = {
  projectStatus?: {
    status?: string;
  };
};

type SonarMeasuresResponse = {
  component?: {
    measures?: Array<{
      metric?: string;
      value?: string;
    }>;
  };
};

type SonarHistoryResponse = {
  measures?: Array<{
    metric?: string;
    history?: Array<{
      date?: string;
      value?: string;
    }>;
  }>;
};

const sonarProjectCache = new Map<string, SonarProjectSummary | null>();
const runSonarRequest = createConcurrencyLimiter(3);

export function hasSonarQubeConfig(runtimeConfig?: RuntimeConfig | null) {
  const baseUrl = preferRuntimeValue(runtimeConfig?.sonarQubeBaseUrl, process.env.SONARQUBE_BASE_URL);
  const token = preferRuntimeValue(runtimeConfig?.sonarQubeToken, process.env.SONARQUBE_TOKEN);
  return Boolean(baseUrl && token);
}

export async function fetchSonarProjectSummary(
  projectKey: string | null,
  runtimeConfig?: RuntimeConfig | null,
): Promise<SonarProjectSummary | null> {
  if (!hasSonarQubeConfig(runtimeConfig) || !projectKey?.trim()) {
    return null;
  }

  const normalizedProjectKey = projectKey.trim();
  const cached = sonarProjectCache.get(getSonarCacheKey(normalizedProjectKey, runtimeConfig));

  if (cached !== undefined) {
    return cached;
  }

  try {
    const summary = await tryFetchSonarProjectSummary(normalizedProjectKey, runtimeConfig);

    if (summary) {
      sonarProjectCache.set(getSonarCacheKey(normalizedProjectKey, runtimeConfig), summary);
      return summary;
    }
  } catch {
    sonarProjectCache.set(getSonarCacheKey(normalizedProjectKey, runtimeConfig), null);
    return null;
  }

  sonarProjectCache.set(getSonarCacheKey(normalizedProjectKey, runtimeConfig), null);
  return null;
}

async function tryFetchSonarProjectSummary(
  projectKey: string,
  runtimeConfig?: RuntimeConfig | null,
): Promise<SonarProjectSummary | null> {
  const [qualityGate, measures, history] = await Promise.all([
    fetchSonarQube<SonarQualityGateResponse>(
      `/api/qualitygates/project_status?projectKey=${encodeURIComponent(projectKey)}`,
      runtimeConfig,
    ),
    fetchSonarQube<SonarMeasuresResponse>(
      `/api/measures/component?component=${encodeURIComponent(projectKey)}&metricKeys=coverage,bugs,vulnerabilities,code_smells,duplicated_lines_density`,
      runtimeConfig,
    ),
    fetchSonarQube<SonarHistoryResponse>(
      `/api/measures/search_history?component=${encodeURIComponent(projectKey)}&metrics=bugs,code_smells&ps=12`,
      runtimeConfig,
    ),
  ]).catch((error: unknown) => {
    if (isSonarNotFoundError(error)) {
      return [null, null, null] as const;
    }

    throw error;
  });

  if (!qualityGate || !measures?.component?.measures) {
    return null;
  }

  const measureMap = new Map(
    measures.component.measures.map((measure) => [measure.metric ?? "", measure.value ?? ""]),
  );
  const historyMap = new Map(
    (history?.measures ?? []).map((measure) => [measure.metric ?? "", measure.history ?? []]),
  );

  return {
    projectKey,
    dashboardUrl: buildSonarDashboardUrl(projectKey, runtimeConfig),
    qualityGateStatus: normalizeQualityGateStatus(qualityGate.projectStatus?.status),
    coverage: parseNumberMetric(measureMap.get("coverage")),
    bugs: parseIntegerMetric(measureMap.get("bugs")),
    bugHistory: parseMetricHistory(historyMap.get("bugs"), parseIntegerMetric),
    vulnerabilities: parseIntegerMetric(measureMap.get("vulnerabilities")),
    codeSmells: parseIntegerMetric(measureMap.get("code_smells")),
    codeSmellHistory: parseMetricHistory(historyMap.get("code_smells"), parseIntegerMetric),
    duplicatedLinesDensity: parseNumberMetric(measureMap.get("duplicated_lines_density")),
  };
}

async function fetchSonarQube<T>(
  path: string,
  runtimeConfig?: RuntimeConfig | null,
): Promise<T> {
  const baseUrl = preferRuntimeValue(
    runtimeConfig?.sonarQubeBaseUrl,
    process.env.SONARQUBE_BASE_URL,
  ).replace(/\/+$/, "");
  const token = preferRuntimeValue(runtimeConfig?.sonarQubeToken, process.env.SONARQUBE_TOKEN);
  let response: Response;

  try {
    response = await runSonarRequest(() =>
      fetch(`${baseUrl}${path}`, {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
    );
  } catch (error) {
    const message = describeRequestError(
      error,
      "Unable to reach SonarQube. Check the base URL, token, and network access.",
    );
    logServerError("sonarqube-request", new Error(message), {
      path,
      baseUrl,
      stage: "network",
    });
    throw new Error(
      message,
    );
  }

  logServerExternalRequest("sonarqube-request", {
    baseUrl,
    method: "GET",
    path,
    status: response.status,
  });
  if (response.ok) {
    return (await response.json()) as T;
  }

  const message = await response.text().catch(() => "");
  logServerError("sonarqube-request", new Error(message || response.statusText), {
    path,
    baseUrl,
    status: response.status,
    statusText: response.statusText,
  });
  throw new Error(
    `SONARQUBE_${response.status}:${message || response.statusText || "Request failed"}`,
  );
}

function buildSonarDashboardUrl(projectKey: string, runtimeConfig?: RuntimeConfig | null) {
  const baseUrl = (
    runtimeConfig?.sonarQubeBaseUrl ?? process.env.SONARQUBE_BASE_URL!.trim()
  ).replace(/\/+$/, "");
  return `${baseUrl}/dashboard?id=${encodeURIComponent(projectKey)}`;
}

function getSonarCacheKey(projectKey: string, runtimeConfig?: RuntimeConfig | null) {
  const baseUrl = runtimeConfig?.sonarQubeBaseUrl ?? process.env.SONARQUBE_BASE_URL?.trim() ?? "";
  const token = runtimeConfig?.sonarQubeToken ?? process.env.SONARQUBE_TOKEN?.trim() ?? "";
  return `${baseUrl.toLowerCase()}|${token}|${projectKey}`;
}

function normalizeQualityGateStatus(status?: string) {
  if (status === "OK") {
    return "passed" as const;
  }

  if (status === "ERROR") {
    return "failed" as const;
  }

  return "unknown" as const;
}

function parseNumberMetric(value?: string) {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseIntegerMetric(value?: string) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMetricHistory(
  history: Array<{ date?: string; value?: string }> | undefined,
  parseValue: (value?: string) => number | null,
): SonarMetricHistoryPoint[] {
  if (!history?.length) {
    return [];
  }

  return history
    .map((entry) => ({
      analyzedAt: entry.date ?? "",
      value: parseValue(entry.value),
    }))
    .filter(
      (entry): entry is SonarMetricHistoryPoint =>
        Boolean(entry.analyzedAt) && entry.value !== null,
    )
    .sort((left, right) => left.analyzedAt.localeCompare(right.analyzedAt));
}

function isSonarNotFoundError(error: unknown) {
  return error instanceof Error && /^SONARQUBE_(400|404):/i.test(error.message);
}
