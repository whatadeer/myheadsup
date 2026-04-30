"use client";

import { useMemo, useState } from "react";
import { PipelineHistogram } from "@/components/pipeline-histogram";
import { ProjectQueryExcludeForm } from "@/components/project-query-exclude-form";
import { ProjectSonarKeyForm } from "@/components/project-sonar-key-form";
import { SonarTrendGrid } from "@/components/sonar-trend-grid";
import { formatMergeRequestMeta } from "@/lib/merge-request-meta";
import { labelPipeline, pipelineStatusEntries, projectPipelineStatus, statusTone } from "@/lib/pipeline";
import type { GroupNode, ProjectSummary } from "@/lib/types";

type GroupTreeFilterProps = {
  group: GroupNode;
  sourceId: string;
};

type VisibleGroupNode = Omit<GroupNode, "projects" | "subgroups"> & {
  projects: ProjectSummary[];
  subgroups: VisibleGroupNode[];
};

export function GroupTreeFilter({ group, sourceId }: GroupTreeFilterProps) {
  const [showIssuesOnly, setShowIssuesOnly] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showMergeRequestsOnly, setShowMergeRequestsOnly] = useState(false);
  const [showUnassignedMergeRequestsOnly, setShowUnassignedMergeRequestsOnly] = useState(false);
  const visibleGroup = useMemo(
    () =>
      filterGroupNode(
        group,
        selectedStatus,
        selectedDate,
        showIssuesOnly,
        showMergeRequestsOnly,
        showUnassignedMergeRequestsOnly,
      ),
    [
      group,
      selectedDate,
      selectedStatus,
      showIssuesOnly,
      showMergeRequestsOnly,
      showUnassignedMergeRequestsOnly,
    ],
  );

  return (
    <>
      <div className="metric-grid">
        <MetricCard
          active={showIssuesOnly}
          detail={
            group.summary.openIssues
              ? showIssuesOnly
                ? "Showing only projects with open issues"
                : "Click to filter projects with open issues"
              : "No open issues in this group"
          }
          label="Open issues"
          onClick={
            group.summary.openIssues
              ? () => setShowIssuesOnly((currentValue) => !currentValue)
              : undefined
          }
          value={group.summary.openIssues}
          valueHref={issuesUrl(group.webUrl)}
        />
        <MetricCard
          active={showMergeRequestsOnly}
          detail={
            group.summary.openMergeRequests
              ? showMergeRequestsOnly
                ? "Showing only projects with open MRs"
                : "Click to filter projects with open MRs"
              : "No open merge requests in this group"
          }
          label="Open merge requests"
          onClick={
            group.summary.openMergeRequests
              ? () => setShowMergeRequestsOnly((currentValue) => !currentValue)
              : undefined
          }
          value={group.summary.openMergeRequests}
        />
        <MetricCard
          active={showUnassignedMergeRequestsOnly}
          detail={
            group.summary.unassignedMergeRequests
              ? showUnassignedMergeRequestsOnly
                ? "Showing only projects with unassigned MRs"
                : "Click to filter projects with unassigned MRs"
              : "No unassigned merge requests in this group"
          }
          label="Unassigned MRs"
          onClick={
            group.summary.unassignedMergeRequests
              ? () => setShowUnassignedMergeRequestsOnly((currentValue) => !currentValue)
              : undefined
          }
          value={group.summary.unassignedMergeRequests}
        />
        <MetricCard
          label="Schedules"
          value={group.summary.schedules.total}
          detail={`${group.summary.schedules.active} active of ${group.summary.schedules.total}`}
        />
        <MetricCard label="Projects" value={group.summary.projectCount} />
      </div>

      <div className="summary-stack">
        <PipelineHistogram
          buckets={group.summary.pipelineActivity}
          label="Pipeline activity (14 days)"
          onClearSelection={() => setSelectedDate(null)}
          onSelectDate={(date) =>
            setSelectedDate((currentDate) => (currentDate === date ? null : date))
          }
          selectedDate={selectedDate}
        />
      </div>

      <div className="summary-stack">
        <h3 className="section-heading">Latest pipeline status across projects</h3>
        <div className="status-list">
          <button
            className={`status-pill status-filter-button${selectedStatus === null ? " active" : ""}`}
            onClick={() => setSelectedStatus(null)}
            type="button"
          >
            All {group.summary.projectCount}
          </button>
          {pipelineStatusEntries(group.summary).map(([status, count]) => (
            <button
              className={`status-pill status-filter-button ${statusTone(status)}${selectedStatus === status ? " active" : ""}`}
              key={status}
              onClick={() =>
                setSelectedStatus((currentStatus) =>
                  currentStatus === status ? null : status,
                )
              }
              type="button"
            >
              {labelPipeline(status)} {count}
            </button>
          ))}
        </div>
      </div>

      <div className="group-tree">
        {visibleGroup.projects.length ? (
          <div className="project-list">
            {visibleGroup.projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                selectedDate={selectedDate}
                sourceId={sourceId}
              />
            ))}
          </div>
        ) : null}

        {visibleGroup.subgroups.map((subgroup) => (
          <GroupTreeNode
            group={subgroup}
            key={subgroup.id}
            selectedDate={selectedDate}
            sourceId={sourceId}
          />
        ))}

        {!visibleGroup.projects.length && !visibleGroup.subgroups.length ? (
          <p className="helper-text">
            No projects match
            {showIssuesOnly ? " with open issues" : ""}
            {showMergeRequestsOnly ? " with open merge requests" : ""}
            {showUnassignedMergeRequestsOnly ? " with unassigned merge requests" : ""}
            {selectedStatus ? ` ${labelPipeline(selectedStatus).toLowerCase()}` : ""}
            {selectedDate ? ` on ${formatSelectedDate(selectedDate)}` : ""}
            {" "}
            in this group.
          </p>
        ) : null}
      </div>
    </>
  );
}

function GroupTreeNode({
  group,
  selectedDate,
  sourceId,
}: {
  group: VisibleGroupNode;
  selectedDate: string | null;
  sourceId: string;
}) {
  return (
    <details className="group-node" open>
      <summary>
        <div className="group-node-header">
          <div className="summary-stack">
            <h3>{group.name}</h3>
            <span className="group-node-path">{group.fullPath}</span>
          </div>
          <div className="group-node-summary">
            <span>{group.projects.length} visible projects</span>
            <a className="metric-inline-link" href={issuesUrl(group.webUrl)} rel="noreferrer" target="_blank">
              {group.summary.openIssues} issues
            </a>
            <span>{group.summary.openMergeRequests} MRs</span>
            <span>{group.summary.unassignedMergeRequests} unassigned</span>
            <span>
              {group.summary.schedules.active}/{group.summary.schedules.total} schedules active
            </span>
          </div>
        </div>
      </summary>
      <div className="group-node-body">
        <div className="group-children">
          {group.projects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              selectedDate={selectedDate}
              sourceId={sourceId}
            />
          ))}
          {group.subgroups.map((subgroup) => (
            <GroupTreeNode
              group={subgroup}
              key={subgroup.id}
              selectedDate={selectedDate}
              sourceId={sourceId}
            />
          ))}
        </div>
      </div>
    </details>
  );
}

function ProjectRow({
  project,
  selectedDate,
  sourceId,
}: {
  project: ProjectSummary;
  selectedDate: string | null;
  sourceId: string;
}) {
  const [selectedTab, setSelectedTab] = useState<"issues" | "merge-requests" | "schedules">(
    project.openMergeRequests
      ? "merge-requests"
      : project.schedules.upcoming.length
        ? "schedules"
        : "issues",
  );

  return (
    <article className="project-row">
      <div className="project-row-content">
        <div className="project-meta">
          <div className="project-title-row">
            <h3>
              <a className="link" href={project.webUrl} rel="noreferrer" target="_blank">
                {project.name}
              </a>
            </h3>
            <details className="project-settings">
              <summary
                aria-label={`Project settings for ${project.name}`}
                className="project-settings-gear"
              >
                <span aria-hidden="true">⚙</span>
                <span className="sr-only">Project settings</span>
              </summary>
              <div className="project-settings-body">
                <div className="project-settings-heading">Project settings</div>
                <ProjectSonarKeyForm
                  currentKey={project.sonarProjectKey}
                  embedded
                  projectId={project.id}
                  projectReference={project.pathWithNamespace}
                  sourceId={sourceId}
                />
                <ProjectQueryExcludeForm
                  projectId={project.id}
                  projectName={project.name}
                  projectReference={project.pathWithNamespace}
                  projectWebUrl={project.webUrl}
                  sourceId={sourceId}
                />
              </div>
            </details>
          </div>
          <span className="source-subtitle">{project.pathWithNamespace}</span>
          <div className="summary-stack project-tab-shell">
            <div className="section-heading-row">
              <span className="section-heading">Detail tabs</span>
              <span className="helper-text">Choose issues, merge requests, or schedules.</span>
            </div>
          <div
            aria-label={`Detail tabs for ${project.name}`}
            className="project-tab-list"
            role="tablist"
          >
            <button
              aria-controls={`project-row-panel-${project.id}-issues`}
              aria-selected={selectedTab === "issues"}
              className={`project-tab${selectedTab === "issues" ? " active" : ""}`}
              id={`project-row-tab-${project.id}-issues`}
              onClick={() => setSelectedTab("issues")}
              role="tab"
              type="button"
            >
              {project.openIssues} issues
            </button>
            <button
              aria-controls={`project-row-panel-${project.id}-merge-requests`}
              aria-selected={selectedTab === "merge-requests"}
              className={`project-tab${selectedTab === "merge-requests" ? " active" : ""}`}
              id={`project-row-tab-${project.id}-merge-requests`}
              onClick={() => setSelectedTab("merge-requests")}
              role="tab"
              type="button"
            >
              {project.openMergeRequests} MRs
            </button>
            {project.unassignedMergeRequests ? (
              <span className="project-tab-meta">{project.unassignedMergeRequests} unassigned</span>
            ) : null}
            <button
              aria-controls={`project-row-panel-${project.id}-schedules`}
              aria-selected={selectedTab === "schedules"}
              className={`project-tab${selectedTab === "schedules" ? " active" : ""}`}
              id={`project-row-tab-${project.id}-schedules`}
              onClick={() => setSelectedTab("schedules")}
              role="tab"
              type="button"
            >
              {project.schedules.total} schedules
            </button>
          </div>
          </div>
          <ProjectTabPanel project={project} selectedTab={selectedTab} />
        </div>
      </div>
      <div className="project-stats">
        <span className={`status-pill ${statusTone(projectPipelineStatus(project))}`}>
          {labelPipeline(projectPipelineStatus(project))}
        </span>
        <div className="project-row-histogram">
          <PipelineHistogram
            buckets={project.pipelineActivity}
            compact
            label="Pipeline activity (14 days)"
            selectedDate={selectedDate}
          />
        </div>
        {project.sonar ? (
          <div className="summary-stack sonar-panel">
            <div className="title-row">
              <h3 className="section-heading">SonarQube</h3>
              <a
                className={`status-pill ${sonarStatusTone(project.sonar.qualityGateStatus)}`}
                href={project.sonar.dashboardUrl}
                rel="noreferrer"
                target="_blank"
              >
                {sonarStatusLabel(project.sonar.qualityGateStatus)}
              </a>
            </div>
            <div className="summary-row">
              <span>{formatPercent(project.sonar.coverage, "coverage")}</span>
              <span>{formatCount(project.sonar.bugs, "bug")}</span>
              <span>{formatCount(project.sonar.vulnerabilities, "vulnerability")}</span>
              <span>{formatCount(project.sonar.codeSmells, "smell")}</span>
            </div>
            <SonarTrendGrid sonar={project.sonar} />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ProjectTabPanel({
  project,
  selectedTab,
}: {
  project: ProjectSummary;
  selectedTab: "issues" | "merge-requests" | "schedules";
}) {
  if (selectedTab === "issues") {
    return (
      <div
        aria-labelledby={`project-row-tab-${project.id}-issues`}
        className="summary-stack"
        id={`project-row-panel-${project.id}-issues`}
        role="tabpanel"
      >
        <h3 className="section-heading">Open issues</h3>
        {project.issues.length ? (
          <div className="merge-request-list">
            {project.issues.map((issue) => (
              <a
                className="merge-request-link"
                href={issue.webUrl}
                key={issue.id}
                rel="noreferrer"
                target="_blank"
              >
                <span className="merge-request-title">#{issue.iid} {issue.title}</span>
              </a>
            ))}
          </div>
        ) : (
          <p className="helper-text">No open issues right now.</p>
        )}
        <a className="text-button" href={issuesUrl(project.webUrl)} rel="noreferrer" target="_blank">
          Open issues in GitLab
        </a>
      </div>
    );
  }

  if (selectedTab === "schedules") {
    return (
      <div
        aria-labelledby={`project-row-tab-${project.id}-schedules`}
        className="summary-stack"
        id={`project-row-panel-${project.id}-schedules`}
        role="tabpanel"
      >
        <h3 className="section-heading">Upcoming schedules</h3>
        {project.schedules.upcoming.length ? (
          <div className="schedule-list">
            {project.schedules.upcoming.map((schedule) => (
              <div className="schedule-item" key={schedule.id}>
                <span className="schedule-item-title">
                  {schedule.description || schedule.ref || `Schedule ${schedule.id}`}
                </span>
                <span className="schedule-item-detail">
                  {formatScheduleDate(schedule.nextRunAt)}
                  {schedule.ref ? ` - ${schedule.ref}` : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="helper-text">No upcoming active schedule runs are available.</p>
        )}
        <a
          className="text-button"
          href={pipelineSchedulesUrl(project.webUrl)}
          rel="noreferrer"
          target="_blank"
        >
          Open schedules in GitLab
        </a>
      </div>
    );
  }

  return (
    <div
      aria-labelledby={`project-row-tab-${project.id}-merge-requests`}
      className="summary-stack"
      id={`project-row-panel-${project.id}-merge-requests`}
      role="tabpanel"
    >
      <h3 className="section-heading">Open merge requests</h3>
      {project.mergeRequests.length ? (
        <div className="merge-request-list">
          {project.mergeRequests.map((mergeRequest) => (
            <a
              className="merge-request-link"
              href={mergeRequest.webUrl}
              key={mergeRequest.id}
              rel="noreferrer"
              target="_blank"
            >
              <span className="merge-request-title">!{mergeRequest.iid} {mergeRequest.title}</span>
              <span className="merge-request-meta">
                {formatMergeRequestMeta(mergeRequest)}
              </span>
            </a>
          ))}
        </div>
      ) : (
        <p className="helper-text">No open merge requests right now.</p>
      )}
    </div>
  );
}

function sonarStatusLabel(status: ProjectSummary["sonar"] extends infer T ? T extends { qualityGateStatus: infer U } ? U : never : never) {
  switch (status) {
    case "passed":
      return "Quality gate passed";
    case "failed":
      return "Quality gate failed";
    default:
      return "Quality gate unknown";
  }
}

function sonarStatusTone(status: ProjectSummary["sonar"] extends infer T ? T extends { qualityGateStatus: infer U } ? U : never : never) {
  switch (status) {
    case "passed":
      return "status-success";
    case "failed":
      return "status-failed";
    default:
      return "status-none";
  }
}

function formatCount(value: number | null, label: string) {
  if (value === null) {
    return `${label}s unknown`;
  }

  return `${value} ${value === 1 ? label : `${label}s`}`;
}

function formatPercent(value: number | null, label: string) {
  if (value === null) {
    return `${label} unknown`;
  }

  return `${value.toFixed(1)}% ${label}`;
}

function filterGroupNode(
  group: GroupNode,
  selectedStatus: string | null,
  selectedDate: string | null,
  showIssuesOnly: boolean,
  showMergeRequestsOnly: boolean,
  showUnassignedMergeRequestsOnly: boolean,
): VisibleGroupNode {
  if (
    !selectedStatus &&
    !selectedDate &&
    !showIssuesOnly &&
    !showMergeRequestsOnly &&
    !showUnassignedMergeRequestsOnly
  ) {
    return {
      ...group,
      projects: group.projects,
      subgroups: group.subgroups.map((subgroup) =>
        filterGroupNode(subgroup, null, null, false, false, false),
      ),
    };
  }

  return {
    ...group,
    projects: group.projects.filter((project) => {
      const matchesStatus = selectedStatus
        ? projectPipelineStatus(project) === selectedStatus
        : true;
      const matchesDate = selectedDate ? hasPipelineActivityOnDate(project, selectedDate) : true;
      const matchesIssues = showIssuesOnly ? project.openIssues > 0 : true;
      const matchesMergeRequests = showMergeRequestsOnly
        ? project.openMergeRequests > 0
        : true;
      const matchesUnassignedMergeRequests = showUnassignedMergeRequestsOnly
        ? project.unassignedMergeRequests > 0
        : true;

      return (
        matchesStatus &&
        matchesDate &&
        matchesIssues &&
        matchesMergeRequests &&
        matchesUnassignedMergeRequests
      );
    }),
    subgroups: group.subgroups
      .map((subgroup) =>
        filterGroupNode(
          subgroup,
          selectedStatus,
          selectedDate,
          showIssuesOnly,
          showMergeRequestsOnly,
          showUnassignedMergeRequestsOnly,
        ),
      )
      .filter((subgroup) => subgroup.projects.length || subgroup.subgroups.length),
  };
}

function MetricCard({
  active = false,
  detail,
  label,
  onClick,
  value,
  valueHref,
}: {
  active?: boolean;
  detail?: string;
  label: string;
  onClick?: () => void;
  value: number | string;
  valueHref?: string;
}) {
  const className = `metric-card${onClick ? " metric-card-button" : ""}${active ? " active" : ""}`;

  if (onClick && !valueHref) {
    return (
      <button className={className} onClick={onClick} type="button">
        <span className="metric-label">{label}</span>
        <span className="metric-value">{value}</span>
        {detail ? <span className="metric-detail">{detail}</span> : null}
      </button>
    );
  }

  return (
    <div className={className}>
      {onClick ? (
        <button className="metric-card-toggle" onClick={onClick} type="button">
          <span className="metric-label">{label}</span>
          {detail ? <span className="metric-detail">{detail}</span> : null}
        </button>
      ) : (
        <>
          <span className="metric-label">{label}</span>
          {detail ? <span className="metric-detail">{detail}</span> : null}
        </>
      )}
      {valueHref ? (
        <a className="metric-value metric-value-link" href={valueHref} rel="noreferrer" target="_blank">
          {value}
        </a>
      ) : (
        <span className="metric-value">{value}</span>
      )}
    </div>
  );
}

function hasPipelineActivityOnDate(project: ProjectSummary, selectedDate: string) {
  return project.pipelineActivity.some(
    (bucket) => bucket.date === selectedDate && bucket.count > 0,
  );
}

function formatSelectedDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function issuesUrl(webUrl: string) {
  return `${webUrl}/-/issues?state=opened`;
}

function pipelineSchedulesUrl(webUrl: string) {
  return `${webUrl}/-/pipeline_schedules`;
}

function formatScheduleDate(value: string | null) {
  if (!value) {
    return "Next run unknown";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

