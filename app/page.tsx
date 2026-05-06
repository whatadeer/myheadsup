import { HomeContent } from "@/components/home-content";
import { getGitLabConfigError } from "@/lib/gitlab";
import { getServerEnvValue } from "@/lib/server-env";
import { readSources } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const savedSources = await readSources();
  const configError = getGitLabConfigError();
  const debugMode = getServerEnvValue("DEBUG_MODE").toLowerCase() === "true";
  const serverUrls = {
    gitlabBaseUrl: getServerEnvValue("GITLAB_BASE_URL") || null,
    jiraBaseUrl: getServerEnvValue("JIRA_BASE_URL") || null,
    sonarQubeBaseUrl: getServerEnvValue("SONARQUBE_BASE_URL") || null,
  };

  return (
    <HomeContent
      key={buildHomeContentKey(savedSources, configError)}
      savedSources={savedSources}
      showDebugUrls={debugMode}
      serverConfigError={configError}
      serverUrls={serverUrls}
    />
  );
}

function buildHomeContentKey(
  savedSources: Awaited<ReturnType<typeof readSources>>,
  configError: string | null,
) {
  return `${configError ?? "configured"}:${savedSources
    .map((source) =>
      JSON.stringify({
        id: source.id,
        kind: source.kind,
        gitlabId: source.gitlabId,
        jiraProjectKeys: source.jiraProjectKeys,
        sonarProjectKey: source.sonarProjectKey,
        projectJiraOverrides: source.projectJiraOverrides,
        projectSonarOverrides: source.projectSonarOverrides,
      }),
    )
    .join("|")}`;
}

