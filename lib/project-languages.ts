import type { ProjectLanguageSummary } from "./types";

export function formatProjectLanguages(
  languages: ProjectLanguageSummary,
  maxItems = 2,
) {
  if (!languages.items.length) {
    return "Languages unavailable";
  }

  return languages.items
    .slice(0, maxItems)
    .map((language) => `${language.name} ${formatLanguagePercentage(language.percentage)}`)
    .join(" · ");
}

export function labelPrimaryLanguage(language: string | null) {
  return language ?? "Unknown";
}

function formatLanguagePercentage(value: number) {
  const rounded =
    value >= 10 || Number.isInteger(value) ? Math.round(value).toString() : value.toFixed(1);

  return `${rounded}%`;
}
