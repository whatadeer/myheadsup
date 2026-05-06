import type { RuntimeConfig } from "./types";

export function emptyRuntimeConfig(): RuntimeConfig {
  return {
    gitlabBaseUrl: "",
    gitlabToken: "",
    jiraBaseUrl: "",
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
    jiraBaseUrl: normalizeBaseUrl(value?.jiraBaseUrl),
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
      config.jiraBaseUrl ||
      config.sonarQubeBaseUrl ||
      config.sonarQubeToken,
  );
}

export function getRuntimeConfigValidationErrorWithOptions(
  config: RuntimeConfig | null | undefined,
  options: { requireGitLab: boolean },
) {
  if (!config) {
    return options.requireGitLab ? "Enter the GitLab base URL and token." : null;
  }

  const hasGitLabBaseUrl = Boolean(config.gitlabBaseUrl);
  const hasGitLabToken = Boolean(config.gitlabToken);

  if (options.requireGitLab) {
    if (!hasGitLabBaseUrl) {
      return "Enter the GitLab base URL.";
    }

    if (!hasGitLabToken) {
      return "Enter the GitLab token.";
    }
  } else if (hasGitLabBaseUrl !== hasGitLabToken) {
    return "Enter both the GitLab base URL and token to override GitLab access, or leave both blank.";
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

export function preferRuntimeValue(runtimeValue: unknown, fallbackValue: string | undefined | null) {
  const normalizedRuntimeValue = normalizeString(runtimeValue);
  if (normalizedRuntimeValue) {
    return normalizedRuntimeValue;
  }

  return normalizeString(fallbackValue);
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
