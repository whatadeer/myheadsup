"use client";

import { useMemo, useState } from "react";
import { PipelineHistogram } from "@/components/pipeline-histogram";
import { ProjectSonarKeyForm } from "@/components/project-sonar-key-form";
import { SonarTrendGrid } from "@/components/sonar-trend-grid";
import { formatMergeRequestMeta } from "@/lib/merge-request-meta";
import { labelPipeline, statusTone } from "@/lib/pipeline";
import type { ProjectSummary } from "@/lib/types";

type ProjectDetailTabsProps = {
  project: ProjectSummary;
  sourceId: string;
};

type ProjectTab = "issues" | "merge-requests" | "schedules";

export function ProjectDetailTabs({ project, sourceId }: ProjectDetailTabsProps) {
  const [selectedTab, setSelectedTab] = useState<ProjectTab>(
    project.openMergeRequests ? "merge-requests" : project.schedules.upcoming.length ? "schedules" : "issues",
  );
  const selectedPanelId = `project-detail-panel-${selectedTab}`;

  const detailContent = useMemo(() => {
    switch (selectedTab) {
      case "issues":
        return (
          <div className="summary-stack">
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
      case "schedules":
        return (
          <div className="summary-stack">
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
      default:
        return (
          <div className="summary-stack">
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
  }, [project, selectedTab]);

  return (
    <>
      <div className="project-detail-top-grid">
        <div className="summary-stack project-detail-tab-shell">
          <div className="section-heading-row">
            <h3 className="section-heading">Detail tabs</h3>
            <span className="helper-text">Choose issues, merge requests, or schedules.</span>
          </div>
          <div
            aria-label={`Detail tabs for ${project.name}`}
            className="metric-grid project-detail-tab-grid"
            role="tablist"
          >
            <TabMetricCard
              active={selectedTab === "issues"}
              detail="Issue tab"
              label="Open issues"
              onClick={() => setSelectedTab("issues")}
              panelId="project-detail-panel-issues"
              tabId="project-detail-tab-issues"
              value={project.openIssues}
            />
            <TabMetricCard
              active={selectedTab === "merge-requests"}
              detail="Merge requests tab"
              label="Open merge requests"
              onClick={() => setSelectedTab("merge-requests")}
              panelId="project-detail-panel-merge-requests"
              tabId="project-detail-tab-merge-requests"
              value={project.openMergeRequests}
            />
            <TabMetricCard
              active={selectedTab === "schedules"}
              detail="Schedules tab"
              label="Schedules"
              onClick={() => setSelectedTab("schedules")}
              panelId="project-detail-panel-schedules"
              tabId="project-detail-tab-schedules"
              value={project.schedules.total}
            />
            <div className="metric-card project-detail-tab-summary">
              <span className="metric-label">Unassigned MRs</span>
              <span className="metric-value">{project.unassignedMergeRequests}</span>
              <span className="metric-detail">Merge request summary</span>
            </div>
          </div>
        </div>
        <div className="metric-card">
          <span className="metric-label">Latest pipeline</span>
          <span className={`status-pill ${statusTone(project.latestPipeline?.status)}`}>
            {labelPipeline(project.latestPipeline?.status)}
          </span>
          <span className="metric-detail">{pipelineDetail(project)}</span>
        </div>
      </div>

      <div className="project-card-detail-grid">
        <div className="summary-stack">
          <ProjectSonarKeyForm
            currentKey={project.sonarProjectKey}
            projectId={project.id}
            projectReference={project.pathWithNamespace}
            sourceId={sourceId}
          />
          <div
            aria-labelledby={`project-detail-tab-${selectedTab}`}
            className="summary-stack"
            id={selectedPanelId}
            role="tabpanel"
          >
            {detailContent}
          </div>
        </div>

        <div className="summary-stack project-card-histogram">
          <PipelineHistogram
            buckets={project.pipelineActivity}
            label="Pipeline activity (14 days)"
          />
          {project.sonar ? <SonarPanel project={project} /> : null}
        </div>
      </div>
    </>
  );
}

function TabMetricCard({
  active,
  detail,
  label,
  onClick,
  panelId,
  tabId,
  value,
}: {
  active: boolean;
  detail: string;
  label: string;
  onClick: () => void;
  panelId: string;
  tabId: string;
  value: number | string;
}) {
  return (
    <button
      aria-controls={panelId}
      aria-selected={active}
      className={`metric-card metric-card-button${active ? " active" : ""}`}
      id={tabId}
      onClick={onClick}
      role="tab"
      type="button"
    >
      <span className="metric-label">{label}</span>
      <span className="metric-value">{value}</span>
      <span className="metric-detail">{detail}</span>
    </button>
  );
}

function SonarPanel({ project }: { project: ProjectSummary }) {
  if (!project.sonar) {
    return null;
  }

  return (
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
        <span>{formatPercent(project.sonar.duplicatedLinesDensity, "duplication")}</span>
      </div>
      <SonarTrendGrid sonar={project.sonar} />
    </div>
  );
}

function issuesUrl(webUrl: string) {
  return `${webUrl}/-/issues?state=opened`;
}

function pipelineSchedulesUrl(webUrl: string) {
  return `${webUrl}/-/pipeline_schedules`;
}

function pipelineDetail(project: ProjectSummary) {
  if (!project.latestPipeline) {
    return "No recent pipeline found";
  }

  const updatedAt = project.latestPipeline.updatedAt
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(project.latestPipeline.updatedAt))
    : "Unknown time";

  return `${project.latestPipeline.ref ?? "unknown ref"} - ${updatedAt}`;
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
