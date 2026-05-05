import type { RuntimeConfig } from "./types";
import { preferRuntimeValue } from "./runtime-config";
import { getServerEnvValue } from "./server-env";

export function resolveJiraBaseUrl(runtimeConfig?: RuntimeConfig | null) {
  const configured = preferRuntimeValue(runtimeConfig?.jiraBaseUrl, getServerEnvValue("JIRA_BASE_URL"));
  const normalized = configured.trim().replace(/\/+$/, "");
  return normalized || null;
}
