import type {
  GroupNode,
  GroupSummary,
  PipelineHistogramBucket,
  ProjectSummary,
} from "./types";

export function summarizeGroup(
  projects: ProjectSummary[],
  subgroups: GroupNode[],
): GroupSummary {
  const summary: GroupSummary = {
    projectCount: projects.length,
    openIssues: projects.reduce((total, project) => total + project.openIssues, 0),
    openMergeRequests: projects.reduce(
      (total, project) => total + project.openMergeRequests,
      0,
    ),
    needsReviewerMergeRequests: projects.reduce(
      (total, project) => total + project.needsReviewerMergeRequests,
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
    summary.needsReviewerMergeRequests += subgroup.summary.needsReviewerMergeRequests;
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

function mergePipelineActivity(activitySets: PipelineHistogramBucket[][]) {
  const counts = new Map<string, PipelineHistogramBucket>();

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
