import {
  fetchPipelineActivity,
  fetchGroupById,
  fetchGroupProjects,
  fetchOpenIssues,
  fetchLatestPipeline,
  fetchOpenMergeRequests,
  fetchProjectLanguages,
  fetchProjectById,
  fetchScheduleSummary,
  fetchSubgroups,
} from "./gitlab";
import { summarizeGroup } from "./group-summary";
import { mergeRequestNeedsReviewer } from "./merge-request-meta";
import { type BaseSourceDashboard } from "./source-dashboard";
import { resolveJiraBaseUrl } from "./server-jira";
import { logServerError } from "./server-log";
import { fetchSonarProjectSummary } from "./sonarqube";
import type {
  GitLabProjectRef,
  GroupNode,
  ProjectSummary,
  RuntimeConfig,
  SavedSource,
} from "./types";

export async function loadBaseSourceDashboard(
  savedSource: SavedSource,
  runtimeConfig?: RuntimeConfig | null,
): Promise<BaseSourceDashboard> {
  try {
    if (savedSource.kind === "project") {
      return {
        kind: "project",
        project: await loadProjectSummary(
          savedSource.gitlabId,
          resolveJiraBaseUrl(runtimeConfig),
          savedSource.jiraProjectKeys,
          savedSource.sonarProjectKey,
          runtimeConfig,
        ),
      };
    }

    const jiraBaseUrl = resolveJiraBaseUrl(runtimeConfig);
    const jiraProjectKeysByGitLabId = new Map(
      savedSource.projectJiraOverrides.map((override) => [
        override.gitlabProjectId,
        override.jiraProjectKeys,
      ]),
    );
    const sonarProjectKeysByGitLabId = new Map(
      savedSource.projectSonarOverrides.map((override) => [
        override.gitlabProjectId,
        override.sonarProjectKey,
      ]),
    );
    const group = await buildGroupNode(
      savedSource.gitlabId,
      jiraBaseUrl,
      jiraProjectKeysByGitLabId,
      sonarProjectKeysByGitLabId,
      runtimeConfig,
    );

    return {
      kind: "group",
      group,
    };
  } catch (error) {
    logServerError("source-dashboard", error, {
      sourceId: savedSource.id,
      sourceKind: savedSource.kind,
      sourceName: savedSource.name,
      sourceReference: savedSource.reference,
      sourceGitLabId: savedSource.gitlabId,
      usesRuntimeConfig: Boolean(runtimeConfig),
    });
    return {
      error: error instanceof Error ? error.message : "Unable to load this source.",
    };
  }
}

export async function refreshSavedSourceProject(
  savedSource: SavedSource,
  projectId: number,
  baseDashboard: BaseSourceDashboard | null,
  runtimeConfig?: RuntimeConfig | null,
): Promise<BaseSourceDashboard> {
  if (savedSource.kind === "project") {
    if (savedSource.gitlabId !== projectId) {
      throw new Error("That project does not belong to this saved source.");
    }

    return loadBaseSourceDashboard(savedSource, runtimeConfig);
  }

  if (!baseDashboard || "error" in baseDashboard || baseDashboard.kind !== "group") {
    return loadBaseSourceDashboard(savedSource, runtimeConfig);
  }

  const jiraBaseUrl = resolveJiraBaseUrl(runtimeConfig);
  const jiraProjectKeysByGitLabId = new Map(
    savedSource.projectJiraOverrides.map((override) => [
      override.gitlabProjectId,
      override.jiraProjectKeys,
    ]),
  );
  const sonarProjectKeysByGitLabId = new Map(
    savedSource.projectSonarOverrides.map((override) => [
      override.gitlabProjectId,
      override.sonarProjectKey,
    ]),
  );
  const refreshed = await refreshProjectInGroupNode(
    baseDashboard.group,
    projectId,
    jiraBaseUrl,
    jiraProjectKeysByGitLabId,
    sonarProjectKeysByGitLabId,
    runtimeConfig,
  );

  if (!refreshed.found) {
    throw new Error("That project is no longer part of this saved group.");
  }

  return {
    kind: "group",
    group: refreshed.group,
  };
}

async function buildGroupNode(
  groupId: number,
  jiraBaseUrl: string | null,
  jiraProjectKeysByGitLabId: Map<number, string[]>,
  sonarProjectKeysByGitLabId: Map<number, string | null>,
  runtimeConfig?: RuntimeConfig | null,
): Promise<GroupNode> {
  const [group, projects, subgroups] = await Promise.all([
    fetchGroupById(groupId, runtimeConfig),
    fetchGroupProjects(groupId, runtimeConfig),
    fetchSubgroups(groupId, runtimeConfig),
  ]);

  const [projectSummaries, subgroupNodes] = await Promise.all([
    Promise.all(
        projects.map((project) =>
          buildProjectSummary(
            project,
            jiraBaseUrl,
            jiraProjectKeysByGitLabId.get(project.id) ?? [],
            sonarProjectKeysByGitLabId.get(project.id) ?? null,
            runtimeConfig,
          ),
        ),
      ),
      Promise.all(
        subgroups.map((subgroup) =>
          buildGroupNode(
            subgroup.id,
            jiraBaseUrl,
            jiraProjectKeysByGitLabId,
            sonarProjectKeysByGitLabId,
            runtimeConfig,
          ),
        ),
      ),
  ]);

  return {
    ...group,
    jiraBaseUrl,
    projects: projectSummaries,
    subgroups: subgroupNodes,
    summary: summarizeGroup(projectSummaries, subgroupNodes),
  };
}

export async function loadProjectSummary(
  projectId: number,
  jiraBaseUrl: string | null,
  jiraProjectKeys: string[],
  sonarProjectKey: string | null,
  runtimeConfig?: RuntimeConfig | null,
) {
  return buildProjectSummary(
    await fetchProjectById(projectId, runtimeConfig),
    jiraBaseUrl,
    jiraProjectKeys,
    sonarProjectKey,
    runtimeConfig,
  );
}

async function buildProjectSummary(
  project: GitLabProjectRef,
  jiraBaseUrl: string | null,
  jiraProjectKeys: string[],
  sonarProjectKey: string | null,
  runtimeConfig?: RuntimeConfig | null,
): Promise<ProjectSummary> {
  const projectWithIssues =
    project.openIssuesCount === null
      ? await fetchProjectById(project.id, runtimeConfig)
      : project;

  const [issues, mergeRequests, schedules, languages, latestPipeline, pipelineActivity, sonar] = await Promise.all([
    fetchOpenIssues(project.id, runtimeConfig),
    fetchOpenMergeRequests(project.id, runtimeConfig),
    fetchScheduleSummary(project.id, runtimeConfig),
    fetchProjectLanguages(project.id, runtimeConfig),
    fetchLatestPipeline(project.id, runtimeConfig),
    fetchPipelineActivity(project.id, runtimeConfig),
    fetchSonarProjectSummary(sonarProjectKey, runtimeConfig),
  ]);

  return {
    id: projectWithIssues.id,
    jiraBaseUrl,
    jiraProjectKeys,
    name: projectWithIssues.name,
    pathWithNamespace: projectWithIssues.pathWithNamespace,
    webUrl: projectWithIssues.webUrl,
    sonarProjectKey,
    openIssues: issues.count,
    issues: issues.items,
    dependencyVulnerabilities: issues.dependencyVulnerabilities,
    openMergeRequests: mergeRequests.count,
    needsReviewerMergeRequests: mergeRequests.items.filter(mergeRequestNeedsReviewer).length,
    mergeRequests: mergeRequests.items,
    sonar,
    schedules,
    languages,
    latestPipeline,
    pipelineActivity,
  };
}

async function refreshProjectInGroupNode(
  group: GroupNode,
  projectId: number,
  jiraBaseUrl: string | null,
  jiraProjectKeysByGitLabId: Map<number, string[]>,
  sonarProjectKeysByGitLabId: Map<number, string | null>,
  runtimeConfig?: RuntimeConfig | null,
): Promise<{ found: boolean; group: GroupNode }> {
  let found = false;

  const projects = await Promise.all(
    group.projects.map(async (project) => {
      if (project.id !== projectId) {
        return project;
      }

      found = true;
      return loadProjectSummary(
        project.id,
        jiraBaseUrl,
        jiraProjectKeysByGitLabId.get(project.id) ?? [],
        sonarProjectKeysByGitLabId.get(project.id) ?? null,
        runtimeConfig,
      );
    }),
  );

  const subgroupResults = await Promise.all(
    group.subgroups.map((subgroup) =>
      refreshProjectInGroupNode(
        subgroup,
        projectId,
        jiraBaseUrl,
        jiraProjectKeysByGitLabId,
        sonarProjectKeysByGitLabId,
        runtimeConfig,
      ),
    ),
  );
  const subgroups = subgroupResults.map((result) => result.group);
  found ||= subgroupResults.some((result) => result.found);

  return {
    found,
    group: {
      ...group,
      jiraBaseUrl,
      projects,
      subgroups,
      summary: summarizeGroup(projects, subgroups),
    },
  };
}
