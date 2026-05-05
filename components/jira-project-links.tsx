"use client";

import { buildJiraBrowseUrl } from "@/lib/jira";

type JiraProjectLinksProps = {
  baseUrl: string | null;
  jiraProjectKeys: string[];
  label?: string;
};

export function JiraProjectLinks({
  baseUrl,
  jiraProjectKeys,
  label = "Jira",
}: JiraProjectLinksProps) {
  if (!jiraProjectKeys.length) {
    return null;
  }

  return (
    <div className="jira-links">
      <span className="jira-links-label">{label}</span>
      <span className="jira-links-values">
        {jiraProjectKeys.map((jiraProjectKey, index) => {
          const url = baseUrl ? buildJiraBrowseUrl(baseUrl, jiraProjectKey) : null;

          return (
            <span className="jira-link-item" key={jiraProjectKey}>
              {url ? (
                <a className="jira-link" href={url} rel="noreferrer" target="_blank">
                  {jiraProjectKey}
                </a>
              ) : (
                <span className="jira-link-fallback">{jiraProjectKey}</span>
              )}
              {index < jiraProjectKeys.length - 1 ? <span>,</span> : null}
            </span>
          );
        })}
      </span>
    </div>
  );
}
