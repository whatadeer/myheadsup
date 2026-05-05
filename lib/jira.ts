export function normalizeJiraProjectKeys(value: string | string[] | null | undefined) {
  const segments = Array.isArray(value) ? value : [value ?? ""];
  const keys = new Set<string>();

  for (const segment of segments) {
    for (const rawKey of segment.split(/[,\n]/)) {
      const key = rawKey.trim().toUpperCase();
      if (key) {
        keys.add(key);
      }
    }
  }

  return [...keys].sort((left, right) =>
    left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }),
  );
}

export function buildJiraBrowseUrl(baseUrl: string, jiraProjectKey: string) {
  const normalizedKey = normalizeJiraProjectKeys([jiraProjectKey])[0];
  if (!normalizedKey) {
    return null;
  }

  const jiraRoot = baseUrl.replace(/\/+$/, "").replace(/\/jira$/, "");
  return `${jiraRoot}/browse/${encodeURIComponent(normalizedKey)}`;
}
