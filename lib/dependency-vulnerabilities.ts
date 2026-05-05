import type { DependencyVulnerabilitySummary } from "./types";

type DependencyDashboardIssue = {
  id: number;
  iid: number;
  title: string;
  webUrl: string;
  description?: string | null;
};

const dependencyDashboardTitlePattern = /dependency dashboard/i;
const dependencyUpdateLinePattern = /\bupdate dependency\b/i;
const bracketTagPattern = /\[([^\[\]\r\n]+)\]/g;
const ignoredSeverityTokens = new Set(["X"]);

export function summarizeDependencyVulnerabilities(
  issues: DependencyDashboardIssue[],
): DependencyVulnerabilitySummary | null {
  const dashboardIssues = issues.filter((issue) => dependencyDashboardTitlePattern.test(issue.title));

  if (!dashboardIssues.length) {
    return null;
  }

  const bySeverity: Record<string, number> = {};
  const items: DependencyVulnerabilitySummary["items"] = [];
  let totalCount = 0;

  for (const issue of dashboardIssues) {
    for (const line of splitLines(issue.description)) {
      const updateText = extractDependencyUpdateText(line);

      if (!updateText) {
        continue;
      }

      const severities = new Set(
        [...updateText.matchAll(bracketTagPattern)]
          .map((match) => normalizeSeverity(match[1]))
          .filter((severity): severity is string => Boolean(severity)),
      );

      if (!severities.size) {
        continue;
      }

      const packageName = extractDependencyPackageName(updateText);
      totalCount += 1;

      for (const severity of severities) {
        bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;

        if (packageName) {
          items.push({
            packageName,
            severity,
          });
        }
      }
    }
  }

  if (!totalCount) {
    return null;
  }

  const sourceIssue = dashboardIssues[0];

  return {
    totalCount,
    bySeverity,
    items,
    issueId: sourceIssue.id,
    issueIid: sourceIssue.iid,
    issueTitle: sourceIssue.title,
    issueWebUrl: sourceIssue.webUrl,
  };
}

function splitLines(value?: string | null) {
  if (!value) {
    return [];
  }

  return value.split(/\r?\n/);
}

function extractDependencyUpdateText(line: string) {
  const match = line.match(dependencyUpdateLinePattern);

  if (!match || match.index === undefined) {
    return null;
  }

  return line.slice(match.index);
}

function extractDependencyPackageName(updateText: string) {
  const match = updateText.match(/update dependency\s+(.+?)\s+to\s+/i);
  return match?.[1]?.trim() || null;
}

function normalizeSeverity(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ").toUpperCase();

  if (!normalized || ignoredSeverityTokens.has(normalized)) {
    return null;
  }

  return normalized;
}
