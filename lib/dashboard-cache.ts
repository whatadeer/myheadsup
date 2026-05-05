import { createHash } from "node:crypto";
import { resolveJiraBaseUrl } from "./server-jira";
import type { RuntimeConfig, SavedSource } from "./types";

const sourceDashboardCacheSchemaVersion = 3;

export function buildSourceDashboardCacheKey(
  savedSource: SavedSource,
  runtimeConfig?: RuntimeConfig | null,
) {
  const payload = JSON.stringify({
    schemaVersion: sourceDashboardCacheSchemaVersion,
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
