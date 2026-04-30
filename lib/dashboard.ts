import {
  fetchPipelineActivity,
  fetchGroupById,
  fetchGroupProjects,
  fetchOpenIssues,
  fetchLatestPipeline,
  fetchOpenMergeRequests,
  fetchProjectById,
  fetchScheduleSummary,
  fetchSubgroups,
} from "./gitlab";
import { logServerError } from "./server-log";
import { fetchSonarProjectSummary } from "./sonarqube";
import type {
  GitLabProjectRef,
  GroupNode,
  GroupSummary,
  ProjectSummary,
  RuntimeConfig,
  SavedSource,
  SourceDashboard,
} from "./types";

export async function loadSourceDashboards(
  savedSources: SavedSource[],
  runtimeConfig?: RuntimeConfig | null,
) {
  return Promise.all(
    savedSources.map((source) => loadSourceDashboard(source, runtimeConfig)),
  );
}

async function loadSourceDashboard(
  savedSource: SavedSource,
  runtimeConfig?: RuntimeConfig | null,
): Promise<SourceDashboard> {
  try {
    if (savedSource.kind === "project") {
      const project = await fetchProjectById(savedSource.gitlabId, runtimeConfig);
      return {
        kind: "project",
        savedSource,
        project: await buildProjectSummary(project, savedSource.sonarProjectKey, runtimeConfig),
      };
    }

    const sonarProjectKeysByGitLabId = new Map(
      savedSource.projectSonarOverrides.map((override) => [
        override.gitlabProjectId,
        override.sonarProjectKey,
      ]),
    );
    const group = await buildGroupNode(
      savedSource.gitlabId,
      sonarProjectKeysByGitLabId,
      runtimeConfig,
    );
    const filteredGroup = applyGroupExclusions(group, savedSource.exclusions);

    if (!filteredGroup) {
      throw new Error("This saved source excludes the root group itself.");
    }

    return {
      kind: "group",
      savedSource,
      group: filteredGroup,
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
      savedSource,
      error: error instanceof Error ? error.message : "Unable to load this source.",
    };
  }
}

async function buildGroupNode(
  groupId: number,
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
            sonarProjectKeysByGitLabId.get(project.id) ?? null,
            runtimeConfig,
          ),
        ),
      ),
      Promise.all(
        subgroups.map((subgroup) =>
          buildGroupNode(subgroup.id, sonarProjectKeysByGitLabId, runtimeConfig),
        ),
      ),
  ]);

  return {
    ...group,
    projects: projectSummaries,
    subgroups: subgroupNodes,
    summary: summarizeGroup(projectSummaries, subgroupNodes),
  };
}

async function buildProjectSummary(
  project: GitLabProjectRef,
  sonarProjectKey: string | null,
  runtimeConfig?: RuntimeConfig | null,
): Promise<ProjectSummary> {
  const projectWithIssues =
    project.openIssuesCount === null
      ? await fetchProjectById(project.id, runtimeConfig)
      : project;

  const [issues, mergeRequests, schedules, latestPipeline, pipelineActivity, sonar] = await Promise.all([
    fetchOpenIssues(project.id, runtimeConfig),
    fetchOpenMergeRequests(project.id, runtimeConfig),
    fetchScheduleSummary(project.id, runtimeConfig),
    fetchLatestPipeline(project.id, runtimeConfig),
    fetchPipelineActivity(project.id, runtimeConfig),
    fetchSonarProjectSummary(sonarProjectKey, runtimeConfig),
  ]);

  return {
    id: projectWithIssues.id,
    name: projectWithIssues.name,
    pathWithNamespace: projectWithIssues.pathWithNamespace,
    webUrl: projectWithIssues.webUrl,
    sonarProjectKey,
    openIssues: issues.count,
    issues: issues.items,
    openMergeRequests: mergeRequests.count,
    unassignedMergeRequests: mergeRequests.items.filter((mergeRequest) => mergeRequest.isUnassigned)
      .length,
    mergeRequests: mergeRequests.items,
    sonar,
    schedules,
    latestPipeline,
    pipelineActivity,
  };
}

function summarizeGroup(projects: ProjectSummary[], subgroups: GroupNode[]): GroupSummary {
  const summary: GroupSummary = {
    projectCount: projects.length,
    openIssues: projects.reduce((total, project) => total + project.openIssues, 0),
    openMergeRequests: projects.reduce(
      (total, project) => total + project.openMergeRequests,
      0,
    ),
    unassignedMergeRequests: projects.reduce(
      (total, project) => total + project.unassignedMergeRequests,
      0,
    ),
    schedules: projects.reduce(
      (total, project) => ({
        active: total.active + project.schedules.active,
        total: total.total + project.schedules.total,
        upcoming: [],
      }),
      { active: 0, total: 0, upcoming: [] },
    ),
    pipelineStatuses: {},
    pipelineActivity: mergePipelineActivity(
      projects.map((project) => project.pipelineActivity),
    ),
  };

  for (const project of projects) {
    const status = normalizePipelineStatus(project.latestPipeline?.status);
    summary.pipelineStatuses[status] = (summary.pipelineStatuses[status] ?? 0) + 1;
  }

  for (const subgroup of subgroups) {
    summary.projectCount += subgroup.summary.projectCount;
    summary.openIssues += subgroup.summary.openIssues;
    summary.openMergeRequests += subgroup.summary.openMergeRequests;
    summary.unassignedMergeRequests += subgroup.summary.unassignedMergeRequests;
    summary.schedules.active += subgroup.summary.schedules.active;
    summary.schedules.total += subgroup.summary.schedules.total;

    for (const [status, count] of Object.entries(subgroup.summary.pipelineStatuses)) {
      summary.pipelineStatuses[status] = (summary.pipelineStatuses[status] ?? 0) + count;
    }

    summary.pipelineActivity = mergePipelineActivity([
      summary.pipelineActivity,
      subgroup.summary.pipelineActivity,
    ]);
  }

  if (Object.keys(summary.pipelineStatuses).length === 0) {
    summary.pipelineStatuses.none = 0;
  }

  return summary;
}

function mergePipelineActivity(
  activitySets: { date: string; count: number; successCount: number; failedCount: number }[][],
) {
  const counts = new Map<
    string,
    { date: string; count: number; successCount: number; failedCount: number }
  >();

  for (const activity of activitySets) {
    for (const bucket of activity) {
      const currentBucket = counts.get(bucket.date) ?? {
        date: bucket.date,
        count: 0,
        successCount: 0,
        failedCount: 0,
      };

      currentBucket.count += bucket.count;
      currentBucket.successCount += bucket.successCount;
      currentBucket.failedCount += bucket.failedCount;
      counts.set(bucket.date, currentBucket);
    }
  }

  return [...counts.values()].sort((leftBucket, rightBucket) =>
    leftBucket.date.localeCompare(rightBucket.date),
  );
}

function normalizePipelineStatus(status?: string | null) {
  if (!status) {
    return "none";
  }

  switch (status) {
    case "success":
    case "failed":
    case "running":
    case "pending":
    case "manual":
    case "scheduled":
    case "canceled":
    case "skipped":
      return status;
    default:
      return "other";
  }
}

function applyGroupExclusions(
  group: GroupNode,
  exclusions: SavedSource["exclusions"],
): GroupNode | null {
  if (!exclusions.length) {
    return group;
  }

  const excludedGroupIds = new Set(
    exclusions.filter((source) => source.kind === "group").map((source) => source.gitlabId),
  );
  const excludedProjectIds = new Set(
    exclusions.filter((source) => source.kind === "project").map((source) => source.gitlabId),
  );

  return pruneGroupNode(group, excludedGroupIds, excludedProjectIds);
}

function pruneGroupNode(
  group: GroupNode,
  excludedGroupIds: Set<number>,
  excludedProjectIds: Set<number>,
): GroupNode | null {
  if (excludedGroupIds.has(group.id)) {
    return null;
  }

  const projects = group.projects.filter((project) => !excludedProjectIds.has(project.id));
  const subgroups = group.subgroups
    .map((subgroup) => pruneGroupNode(subgroup, excludedGroupIds, excludedProjectIds))
    .filter((subgroup): subgroup is GroupNode => Boolean(subgroup));

  return {
    ...group,
    projects,
    subgroups,
    summary: summarizeGroup(projects, subgroups),
  };
}
