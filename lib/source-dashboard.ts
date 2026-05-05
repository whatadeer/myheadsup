import type { GroupNode, ProjectSummary, SavedSource, SourceDashboard } from "./types";

export type BaseSourceDashboard =
  | {
      kind: "project";
      project: ProjectSummary;
    }
  | {
      kind: "group";
      group: GroupNode;
    }
  | {
      error: string;
    };

export function materializeSourceDashboard(
  savedSource: SavedSource,
  baseDashboard: BaseSourceDashboard,
): SourceDashboard {
  if ("error" in baseDashboard) {
    return {
      savedSource,
      error: baseDashboard.error,
    };
  }

  if (baseDashboard.kind === "project") {
    return {
      kind: "project",
      savedSource,
      project: baseDashboard.project,
    };
  }

  const filteredGroup = applyGroupExclusions(baseDashboard.group, savedSource.exclusions);

  if (!filteredGroup) {
    return {
      savedSource,
      error: "This saved source excludes the root group itself.",
    };
  }

  return {
    kind: "group",
    savedSource,
    group: filteredGroup,
  };
}

export function reconcileDashboardsWithSavedSources(
  currentDashboards: SourceDashboard[],
  savedSources: SavedSource[],
) {
  const currentBySourceId = new Map(
    currentDashboards.map((dashboard) => [dashboard.savedSource.id, dashboard]),
  );

  return savedSources.flatMap((savedSource) => {
    const currentDashboard = currentBySourceId.get(savedSource.id);

    if (!currentDashboard) {
      return [];
    }

    if ("error" in currentDashboard) {
      return [
        {
          ...currentDashboard,
          savedSource,
        },
      ];
    }

    if (currentDashboard.kind !== savedSource.kind) {
      return [];
    }

    if (currentDashboard.kind === "project") {
      return [
        {
          ...currentDashboard,
          savedSource,
        },
      ];
    }

    return [materializeSourceDashboard(savedSource, currentDashboard)];
  });
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

function summarizeGroup(projects: ProjectSummary[], subgroups: GroupNode[]) {
  const summary: GroupNode["summary"] = {
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
