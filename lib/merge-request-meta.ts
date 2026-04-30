import type { MergeRequestSummary } from "@/lib/types";

export function formatMergeRequestMeta(mergeRequest: MergeRequestSummary) {
  const reviewerLabel = formatReviewerLabel(mergeRequest.reviewerNames);
  const assigneeLabel = mergeRequest.assigneeNames.length
    ? `Assigned to ${mergeRequest.assigneeNames.join(", ")}`
    : null;

  if (assigneeLabel) {
    return `${assigneeLabel} - ${reviewerLabel}`;
  }

  return reviewerLabel;
}

function formatReviewerLabel(reviewerNames: string[]) {
  if (!reviewerNames.length) {
    return "No Reviewers";
  }

  return `Reviewer${reviewerNames.length === 1 ? "" : "s"} ${reviewerNames.join(", ")}`;
}
