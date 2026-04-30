import type { GroupSummary, ProjectSummary } from "./types";

export function pipelineStatusEntries(summary: GroupSummary) {
  const order = [
    "failed",
    "running",
    "pending",
    "success",
    "manual",
    "scheduled",
    "canceled",
    "skipped",
    "none",
    "other",
  ];

  return Object.entries(summary.pipelineStatuses).sort((left, right) => {
    const leftIndex = order.indexOf(left[0]);
    const rightIndex = order.indexOf(right[0]);

    return (leftIndex === -1 ? order.length : leftIndex) -
      (rightIndex === -1 ? order.length : rightIndex);
  });
}

export function labelPipeline(status?: string | null) {
  if (!status) {
    return "No pipeline";
  }

  return status.replace(/_/g, " ");
}

export function statusTone(status?: string | null) {
  switch (status) {
    case "success":
      return "status-success";
    case "failed":
      return "status-failed";
    case "canceled":
      return "status-canceled";
    case "running":
      return "status-running";
    case "pending":
      return "status-pending";
    case "manual":
      return "status-manual";
    case "scheduled":
      return "status-scheduled";
    case "skipped":
      return "status-skipped";
    case "none":
      return "status-none";
    default:
      return "status-warning";
  }
}

export function projectPipelineStatus(project: ProjectSummary) {
  return project.latestPipeline?.status ?? "none";
}
