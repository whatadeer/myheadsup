import type { RuntimeConfig } from "./types";

export function emptyRuntimeConfig(): RuntimeConfig {
  return {
    gitlabBaseUrl: "",
    gitlabToken: "",
    sonarQubeBaseUrl: "",
    sonarQubeToken: "",
  };
}

export function sanitizeRuntimeConfig(
  value: Partial<RuntimeConfig> | null | undefined,
): RuntimeConfig {
  return {
    gitlabBaseUrl: normalizeBaseUrl(value?.gitlabBaseUrl),
    gitlabToken: normalizeString(value?.gitlabToken),
    sonarQubeBaseUrl: normalizeBaseUrl(value?.sonarQubeBaseUrl),
    sonarQubeToken: normalizeString(value?.sonarQubeToken),
  };
}

export function parseRuntimeConfigValue(value: unknown): RuntimeConfig | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const runtimeConfig = sanitizeRuntimeConfig(value as Partial<RuntimeConfig>);
  return hasRuntimeConfigValues(runtimeConfig) ? runtimeConfig : null;
}

export function parseRuntimeConfigString(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return parseRuntimeConfigValue(parsed);
  } catch {
    throw new Error("The saved browser configuration could not be read.");
  }
}

export function hasRuntimeConfigValues(config: RuntimeConfig | null | undefined) {
  if (!config) {
    return false;
  }

  return Boolean(
    config.gitlabBaseUrl ||
      config.gitlabToken ||
      config.sonarQubeBaseUrl ||
      config.sonarQubeToken,
  );
}

export function getRuntimeConfigValidationError(config: RuntimeConfig | null | undefined) {
  if (!config) {
    return "Enter the GitLab base URL and token.";
  }

  if (!config.gitlabBaseUrl) {
    return "Enter the GitLab base URL.";
  }

  if (!config.gitlabToken) {
    return "Enter the GitLab token.";
  }

  const hasSonarBaseUrl = Boolean(config.sonarQubeBaseUrl);
  const hasSonarToken = Boolean(config.sonarQubeToken);

  if (hasSonarBaseUrl !== hasSonarToken) {
    return "Enter both the SonarQube base URL and token, or leave both blank.";
  }

  return null;
}

function normalizeBaseUrl(value: unknown) {
  return normalizeString(value).replace(/\/+$/, "");
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
