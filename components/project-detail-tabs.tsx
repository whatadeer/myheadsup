"use client";

import { useMemo, useState } from "react";
import { DependencyVulnerabilityPanel } from "@/components/dependency-vulnerability-panel";
import { JiraProjectLinks } from "@/components/jira-project-links";
import { PipelineHistogram } from "@/components/pipeline-histogram";
import { ProjectJiraKeyForm } from "@/components/project-jira-key-form";
import { ProjectReloadButton } from "@/components/project-reload-button";
import { ScheduleRunButton } from "@/components/schedule-run-button";
import { ProjectSonarKeyForm } from "@/components/project-sonar-key-form";
import { SonarTrendGrid } from "@/components/sonar-trend-grid";
import { formatMergeRequestMeta } from "@/lib/merge-request-meta";
import { labelPipeline, statusTone } from "@/lib/pipeline";
import type { ActionState, ProjectSummary, RuntimeConfig } from "@/lib/types";

type ProjectDetailTabsProps = {
  idPrefix?: string;
  onReloadProject?: () => Promise<ActionState>;
  onScheduleTriggered?: () => void;
  project: ProjectSummary;
  runtimeConfig?: RuntimeConfig | null;
  sourceId?: string;
  variant?: "full" | "embedded";
};

type ProjectTab = "merge-requests" | "schedules" | "vulnerabilities";

export function ProjectDetailTabs({
  idPrefix = "project-detail",
  onReloadProject,
  onScheduleTriggered,
  project,
  runtimeConfig,
  sourceId,
  variant = "full",
}: ProjectDetailTabsProps) {
  const [selectedTab, setSelectedTab] = useState<ProjectTab>(
    project.openMergeRequests
      ? "merge-requests"
      : project.dependencyVulnerabilities
        ? "vulnerabilities"
        : "schedules",
  );
  const selectedPanelId = `${idPrefix}-panel-${selectedTab}`;

  const detailContent = useMemo(() => {
    switch (selectedTab) {
      case "vulnerabilities":
        return project.dependencyVulnerabilities ? (
          <DependencyVulnerabilityPanel summary={project.dependencyVulnerabilities} />
        ) : (
          <div className="summary-stack">
            <h3 className="section-heading">Vulnerable dependencies</h3>
            <p className="helper-text">No vulnerable dependencies right now.</p>
          </div>
        );
      case "schedules":
        return (
          <div className="summary-stack">
            <h3 className="section-heading">Upcoming schedules</h3>
            {project.schedules.upcoming.length ? (
              <ul className="schedule-list">
                {project.schedules.upcoming.map((schedule) => (
                  <li className="schedule-item" key={schedule.id}>
                    <span className="schedule-item-title">
                      {schedule.description || schedule.ref || `Schedule ${schedule.id}`}
                    </span>
                    <span className="schedule-item-detail">
                      {formatScheduleDate(schedule.nextRunAt)}
                      {schedule.ref ? ` - ${schedule.ref}` : ""}
                    </span>
                    <ScheduleRunButton
                      onTriggered={onScheduleTriggered}
                      projectId={project.id}
                      runtimeConfig={runtimeConfig}
                      scheduleId={schedule.id}
                    />
                  </li>
                ))}
              </ul>
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
  }, [onScheduleTriggered, project, runtimeConfig, selectedTab]);

  const tabStrip = (
    <div
      aria-label={`Detail tabs for ${project.name}`}
      className="project-detail-tab-list"
      role="tablist"
    >
      <TabButton
        active={selectedTab === "merge-requests"}
        count={project.openMergeRequests}
        detail={
          project.needsReviewerMergeRequests
            ? formatNeedsReviewerCount(project.needsReviewerMergeRequests)
            : null
        }
        label="Merge requests"
        onClick={() => setSelectedTab("merge-requests")}
        panelId={`${idPrefix}-panel-merge-requests`}
        tabId={`${idPrefix}-tab-merge-requests`}
      />
      <TabButton
        active={selectedTab === "schedules"}
        count={project.schedules.total}
        label="Schedules"
        onClick={() => setSelectedTab("schedules")}
        panelId={`${idPrefix}-panel-schedules`}
        tabId={`${idPrefix}-tab-schedules`}
      />
      <TabButton
        active={selectedTab === "vulnerabilities"}
        count={project.dependencyVulnerabilities?.totalCount ?? 0}
        label="Vulnerabilities"
        onClick={() => setSelectedTab("vulnerabilities")}
        panelId={`${idPrefix}-panel-vulnerabilities`}
        tabId={`${idPrefix}-tab-vulnerabilities`}
      />
    </div>
  );

  const detailPanel = (
    <div
      aria-labelledby={`${idPrefix}-tab-${selectedTab}`}
      className="summary-stack project-detail-tab-panel"
      id={selectedPanelId}
      role="tabpanel"
    >
      {detailContent}
    </div>
  );

  if (variant === "embedded") {
    return (
      <div className="project-detail-tab-embedded">
        <div className="summary-stack project-detail-tab-shell">{tabStrip}</div>
        {detailPanel}
      </div>
    );
  }

  return (
    <>
      <div className="project-detail-top-grid">
        <div className="summary-stack project-detail-tab-shell">{tabStrip}</div>
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
          {sourceId ? (
            <>
              {onReloadProject ? (
                <ProjectReloadButton onReload={onReloadProject} />
              ) : null}
              <ProjectJiraKeyForm
                currentKeys={project.jiraProjectKeys}
                jiraBaseUrl={project.jiraBaseUrl}
                projectId={project.id}
                projectReference={project.pathWithNamespace}
                sourceId={sourceId}
              />
              <ProjectSonarKeyForm
                currentKey={project.sonarProjectKey}
                projectId={project.id}
                projectReference={project.pathWithNamespace}
                sourceId={sourceId}
              />
            </>
          ) : null}
          {detailPanel}
        </div>

        <div className="summary-stack project-card-histogram">
          <JiraProjectLinks
            baseUrl={project.jiraBaseUrl}
            jiraProjectKeys={project.jiraProjectKeys}
            label="Jira projects"
          />
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

function formatNeedsReviewerCount(count: number) {
  return `${count} need${count === 1 ? "s" : ""} reviewer`;
}

function TabButton({
  active,
  count,
  detail,
  label,
  onClick,
  panelId,
  tabId,
}: {
  active: boolean;
  count: number | string;
  detail?: string | null;
  label: string;
  onClick: () => void;
  panelId: string;
  tabId: string;
}) {
  return (
    <button
      aria-controls={panelId}
      aria-selected={active}
      className={`project-detail-tab${active ? " active" : ""}`}
      id={tabId}
      onClick={onClick}
      role="tab"
      type="button"
    >
      <span className="project-detail-tab-title">
        <span className="project-detail-tab-label">{label}</span>
        <span className="project-detail-tab-badge">{count}</span>
      </span>
      {detail ? <span className="project-detail-tab-detail">{detail}</span> : null}
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
