import type { MergeRequestSummary } from "@/lib/types";

export function formatMergeRequestMeta(mergeRequest: MergeRequestSummary) {
  const reviewerLabel = formatReviewerLabel(mergeRequest.reviewerNames);
  const assigneeLabel = mergeRequest.assigneeNames.length
    ? `Assigned to ${mergeRequest.assigneeNames.join(", ")}`
    : null;
  const statusLabels = [
    mergeRequest.isApproved ? "Approved" : "Needs approval",
    mergeRequest.needsRebase ? "Needs rebase" : null,
  ].filter((label): label is string => Boolean(label));

  return [...statusLabels, assigneeLabel, reviewerLabel].filter(Boolean).join(" - ");
}

function formatReviewerLabel(reviewerNames: string[]) {
  if (!reviewerNames.length) {
    return "No Reviewers";
  }

  return `Reviewer${reviewerNames.length === 1 ? "" : "s"} ${reviewerNames.join(", ")}`;
}
