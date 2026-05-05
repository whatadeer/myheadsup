"use client";

import { useMemo, useState } from "react";
import {
  CollapsibleRollup,
} from "@/components/collapsible-rollup";
import {
  DependencyVulnerabilityGroupSummary,
  type DependencyVulnerabilityGroupSummaryEntry,
} from "@/components/dependency-vulnerability-group-summary";
import { DependencyVulnerabilityPanel } from "@/components/dependency-vulnerability-panel";
import { JiraProjectLinks } from "@/components/jira-project-links";
import { GroupQueryExcludeForm } from "@/components/group-query-exclude-form";
import { ProjectDetailTabs } from "@/components/project-detail-tabs";
import { ProjectJiraKeyForm } from "@/components/project-jira-key-form";
import { PipelineHistogram } from "@/components/pipeline-histogram";
import { ProjectQueryExcludeForm } from "@/components/project-query-exclude-form";
import { ProjectReloadButton } from "@/components/project-reload-button";
import { ScheduleRunButton } from "@/components/schedule-run-button";
import { ProjectSonarKeyForm } from "@/components/project-sonar-key-form";
import { SonarTrendGrid } from "@/components/sonar-trend-grid";
import { formatProjectLanguages, labelPrimaryLanguage } from "@/lib/project-languages";
import { labelPipeline, pipelineStatusEntries, projectPipelineStatus, statusTone } from "@/lib/pipeline";
import type { ActionState, GroupNode, ProjectSummary, RuntimeConfig } from "@/lib/types";

type GroupTreeFilterProps = {
  group: GroupNode;
  onReloadProject?: (projectId: number, projectName: string) => Promise<ActionState>;
  onScheduleTriggered?: () => void;
  runtimeConfig?: RuntimeConfig | null;
  sourceId: string;
};

type VisibleGroupNode = Omit<GroupNode, "projects" | "subgroups"> & {
  projects: ProjectSummary[];
  subgroups: VisibleGroupNode[];
};

export function GroupTreeFilter({
  group,
  onReloadProject,
  onScheduleTriggered,
  runtimeConfig,
  sourceId,
}: GroupTreeFilterProps) {
  const [showIssuesOnly, setShowIssuesOnly] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showMergeRequestsOnly, setShowMergeRequestsOnly] = useState(false);
  const [showUnassignedMergeRequestsOnly, setShowUnassignedMergeRequestsOnly] = useState(false);
  const [showSchedulesOnly, setShowSchedulesOnly] = useState(false);
  const [showWithoutSchedulesOnly, setShowWithoutSchedulesOnly] = useState(false);
  const [showDependencyVulnerabilitiesOnly, setShowDependencyVulnerabilitiesOnly] = useState(false);
  const [selectedDependencySeverity, setSelectedDependencySeverity] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const projectsWithoutSchedules = useMemo(
    () => countProjects(group, (project) => project.schedules.total === 0),
    [group],
  );
  const dependencyVulnerabilityCount = useMemo(
    () => countDependencyVulnerabilities(group),
    [group],
  );
  const dependencySeverityEntries = useMemo(() => collectDependencySeverityEntries(group), [group]);
  const languageEntries = useMemo(() => primaryLanguageEntries(group), [group]);
  const visibleGroup = useMemo(
    () =>
      filterGroupNode(
        group,
        selectedStatus,
        selectedLanguage,
        selectedDate,
        showIssuesOnly,
        showMergeRequestsOnly,
        showUnassignedMergeRequestsOnly,
        showSchedulesOnly,
        showWithoutSchedulesOnly,
        showDependencyVulnerabilitiesOnly,
        selectedDependencySeverity,
      ),
    [
      group,
      selectedLanguage,
      selectedDate,
      selectedStatus,
      selectedDependencySeverity,
      showDependencyVulnerabilitiesOnly,
      showIssuesOnly,
      showMergeRequestsOnly,
      showUnassignedMergeRequestsOnly,
      showSchedulesOnly,
      showWithoutSchedulesOnly,
    ],
  );
  const dependencyPackageEntries = useMemo(
    () => collectDependencyPackageEntries(visibleGroup, selectedDependencySeverity),
    [selectedDependencySeverity, visibleGroup],
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
          active={showSchedulesOnly}
          detail={
            group.summary.schedules.total
              ? showSchedulesOnly
                ? "Showing only projects with schedules"
                : "Click to filter projects with schedules"
              : "No schedules in this group"
          }
          label="Schedules"
          onClick={
            group.summary.schedules.total
              ? () => {
                  setShowSchedulesOnly((currentValue) => !currentValue);
                  setShowWithoutSchedulesOnly(false);
                }
              : undefined
          }
          value={`${group.summary.schedules.active} of ${group.summary.schedules.total}`}
        />
        <MetricCard
          active={showWithoutSchedulesOnly}
          detail={
            projectsWithoutSchedules
              ? showWithoutSchedulesOnly
                ? "Showing only projects without schedules"
                : "Click to filter projects without schedules"
              : "Every project has a schedule"
          }
          label="Without schedules"
          onClick={
            projectsWithoutSchedules
              ? () => {
                  setShowWithoutSchedulesOnly((currentValue) => !currentValue);
                  setShowSchedulesOnly(false);
                }
              : undefined
          }
          value={projectsWithoutSchedules}
        />
        <MetricCard
          active={showDependencyVulnerabilitiesOnly}
          detail={
            dependencyVulnerabilityCount
              ? showDependencyVulnerabilitiesOnly
                ? "Showing only projects with impacted dependencies"
                : "Click to filter projects with impacted dependencies"
              : "No impacted dependencies found in this group"
          }
          label="Dependencies impacted"
          onClick={
            dependencyVulnerabilityCount
              ? () => setShowDependencyVulnerabilitiesOnly((currentValue) => !currentValue)
              : undefined
          }
          value={dependencyVulnerabilityCount}
        />
      </div>

      <div className="summary-stack">
        <h3 className="section-heading">Dependency severity</h3>
        <div className="status-list">
          <button
            className={`status-pill status-filter-button${selectedDependencySeverity === null ? " active" : ""}`}
            onClick={() => setSelectedDependencySeverity(null)}
            type="button"
          >
            All {dependencyVulnerabilityCount}
          </button>
          {dependencySeverityEntries.map(([severity, count]) => (
            <button
              className={`status-pill status-filter-button${selectedDependencySeverity === severity ? " active" : ""}`}
              key={severity}
              onClick={() =>
                setSelectedDependencySeverity((currentSeverity) =>
                  currentSeverity === severity ? null : severity,
                )
              }
              type="button"
            >
              {severity} {count}
            </button>
          ))}
        </div>
      </div>

      <div className="summary-stack">
        <h3 className="section-heading">Primary language</h3>
        <div className="status-list">
          <button
            className={`status-pill status-filter-button${selectedLanguage === null ? " active" : ""}`}
            onClick={() => setSelectedLanguage(null)}
            type="button"
          >
            All {group.summary.projectCount}
          </button>
          {languageEntries.map(([language, count]) => (
            <button
              className={`status-pill status-filter-button${selectedLanguage === language ? " active" : ""}`}
              key={language}
              onClick={() =>
                setSelectedLanguage((currentLanguage) =>
                  currentLanguage === language ? null : language,
                )
              }
              type="button"
            >
              {labelPrimaryLanguage(language)} {count}
            </button>
          ))}
        </div>
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

      <NextScheduledRuns
        group={group}
        onScheduleTriggered={onScheduleTriggered}
        runtimeConfig={runtimeConfig}
      />
      <DependencyVulnerabilityGroupSummary
        entries={dependencyPackageEntries}
        selectedSeverity={selectedDependencySeverity}
      />

      <div className="group-tree">
        {visibleGroup.projects.length ? (
          <div className="project-list">
            {visibleGroup.projects.map((project) => (
              <ProjectRow
                key={project.id}
                onReloadProject={onReloadProject}
                onScheduleTriggered={onScheduleTriggered}
                project={project}
                runtimeConfig={runtimeConfig}
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
            onReloadProject={onReloadProject}
            onScheduleTriggered={onScheduleTriggered}
            runtimeConfig={runtimeConfig}
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
            {showSchedulesOnly ? " with schedules" : ""}
            {showWithoutSchedulesOnly ? " without schedules" : ""}
            {selectedDependencySeverity
              ? ` with ${selectedDependencySeverity.toLowerCase()} impacted dependencies`
              : showDependencyVulnerabilitiesOnly
                ? " with impacted dependencies"
                : ""}
            {selectedLanguage ? ` for ${selectedLanguage}` : ""}
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
  onReloadProject,
  onScheduleTriggered,
  runtimeConfig,
  selectedDate,
  sourceId,
}: {
  group: VisibleGroupNode;
  onReloadProject?: (projectId: number, projectName: string) => Promise<ActionState>;
  onScheduleTriggered?: () => void;
  runtimeConfig?: RuntimeConfig | null;
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
            <GroupQueryExcludeForm
              groupId={group.id}
              groupName={group.name}
              groupReference={group.fullPath}
              groupWebUrl={group.webUrl}
              sourceId={sourceId}
            />
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
              onReloadProject={onReloadProject}
              onScheduleTriggered={onScheduleTriggered}
              project={project}
              runtimeConfig={runtimeConfig}
              selectedDate={selectedDate}
              sourceId={sourceId}
            />
          ))}
          {group.subgroups.map((subgroup) => (
            <GroupTreeNode
              group={subgroup}
              key={subgroup.id}
              onReloadProject={onReloadProject}
              onScheduleTriggered={onScheduleTriggered}
              runtimeConfig={runtimeConfig}
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
  onReloadProject,
  onScheduleTriggered,
  project,
  runtimeConfig,
  selectedDate,
  sourceId,
}: {
  onReloadProject?: (projectId: number, projectName: string) => Promise<ActionState>;
  onScheduleTriggered?: () => void;
  project: ProjectSummary;
  runtimeConfig?: RuntimeConfig | null;
  selectedDate: string | null;
  sourceId: string;
}) {
  return (
    <article className="project-row" id={`project-row-${project.id}`}>
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
                {onReloadProject ? (
                  <ProjectReloadButton
                    onReload={() => onReloadProject(project.id, project.name)}
                  />
                ) : null}
                <ProjectJiraKeyForm
                  currentKeys={project.jiraProjectKeys}
                  embedded
                  jiraBaseUrl={project.jiraBaseUrl}
                  projectId={project.id}
                  projectReference={project.pathWithNamespace}
                  sourceId={sourceId}
                />
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
          <span className="project-language-summary">
            Languages: {formatProjectLanguages(project.languages)}
          </span>
          <JiraProjectLinks
            baseUrl={project.jiraBaseUrl}
            jiraProjectKeys={project.jiraProjectKeys}
            label="Jira projects"
          />
          {project.dependencyVulnerabilities ? (
            <DependencyVulnerabilityPanel summary={project.dependencyVulnerabilities} />
          ) : null}
          <ProjectDetailTabs
            idPrefix={`project-row-${project.id}`}
            onScheduleTriggered={onScheduleTriggered}
            project={project}
            runtimeConfig={runtimeConfig}
            variant="embedded"
          />
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
  selectedLanguage: string | null,
  selectedDate: string | null,
  showIssuesOnly: boolean,
  showMergeRequestsOnly: boolean,
  showUnassignedMergeRequestsOnly: boolean,
  showSchedulesOnly: boolean,
  showWithoutSchedulesOnly: boolean,
  showDependencyVulnerabilitiesOnly: boolean,
  selectedDependencySeverity: string | null,
): VisibleGroupNode {
  if (
    !selectedStatus &&
    !selectedLanguage &&
    !selectedDate &&
    !showIssuesOnly &&
    !showMergeRequestsOnly &&
    !showUnassignedMergeRequestsOnly &&
    !showSchedulesOnly &&
    !showWithoutSchedulesOnly &&
    !showDependencyVulnerabilitiesOnly &&
    !selectedDependencySeverity
  ) {
    return {
      ...group,
      projects: group.projects,
      subgroups: group.subgroups.map((subgroup) =>
        filterGroupNode(subgroup, null, null, null, false, false, false, false, false, false, null),
      ),
    };
  }

  return {
    ...group,
    projects: group.projects.filter((project) => {
      const matchesStatus = selectedStatus
        ? projectPipelineStatus(project) === selectedStatus
        : true;
      const matchesLanguage = selectedLanguage
        ? project.languages.primary === selectedLanguage
        : true;
      const matchesDate = selectedDate ? hasPipelineActivityOnDate(project, selectedDate) : true;
      const matchesIssues = showIssuesOnly ? project.openIssues > 0 : true;
      const matchesMergeRequests = showMergeRequestsOnly
        ? project.openMergeRequests > 0
        : true;
      const matchesUnassignedMergeRequests = showUnassignedMergeRequestsOnly
        ? project.unassignedMergeRequests > 0
        : true;
      const matchesSchedules = showSchedulesOnly
        ? project.schedules.total > 0
        : true;
      const matchesWithoutSchedules = showWithoutSchedulesOnly
        ? project.schedules.total === 0
        : true;
      const matchesDependencyVulnerabilities = showDependencyVulnerabilitiesOnly
        ? projectHasDependencyVulnerabilities(project)
        : true;
      const matchesDependencySeverity = selectedDependencySeverity
        ? projectHasDependencySeverity(project, selectedDependencySeverity)
        : true;

      return (
        matchesStatus &&
        matchesLanguage &&
        matchesDate &&
        matchesIssues &&
        matchesMergeRequests &&
        matchesUnassignedMergeRequests &&
        matchesSchedules &&
        matchesWithoutSchedules &&
        matchesDependencyVulnerabilities &&
        matchesDependencySeverity
      );
    }),
    subgroups: group.subgroups
      .map((subgroup) =>
        filterGroupNode(
          subgroup,
          selectedStatus,
          selectedLanguage,
          selectedDate,
          showIssuesOnly,
          showMergeRequestsOnly,
          showUnassignedMergeRequestsOnly,
          showSchedulesOnly,
          showWithoutSchedulesOnly,
          showDependencyVulnerabilitiesOnly,
          selectedDependencySeverity,
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
        <span className="metric-card-content">
          <span className="metric-label">{label}</span>
          <span className="metric-value">{value}</span>
          {detail ? <span className="metric-detail">{detail}</span> : null}
        </span>
      </button>
    );
  }

  return (
    <div className={className}>
      {onClick ? (
        <button className="metric-card-toggle metric-card-title-button" onClick={onClick} type="button">
          <span className="metric-label">{label}</span>
        </button>
      ) : (
        <span className="metric-label">
          {label}
        </span>
      )}
      {valueHref ? (
        <a className="metric-value metric-value-link" href={valueHref} rel="noreferrer" target="_blank">
          {value}
        </a>
      ) : (
        <span className="metric-value">{value}</span>
      )}
      {detail ? <span className="metric-detail">{detail}</span> : null}
    </div>
  );
}

function countDependencyVulnerabilities(group: GroupNode) {
  let total = 0;

  countProjects(group, (project) => {
    total += project.dependencyVulnerabilities?.totalCount ?? 0;
    return false;
  });

  return total;
}

function collectDependencySeverityEntries(group: GroupNode) {
  const counts = new Map<string, number>();

  countProjects(group, (project) => {
    for (const [severity, count] of Object.entries(
      project.dependencyVulnerabilities?.bySeverity ?? {},
    )) {
      counts.set(severity, (counts.get(severity) ?? 0) + count);
    }

    return false;
  });

  return [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
}

function collectDependencyPackageEntries(
  group: GroupNode,
  selectedSeverity: string | null,
): DependencyVulnerabilityGroupSummaryEntry[] {
  const entries = new Map<
    string,
    {
      bySeverity: Record<string, number>;
      packageName: string;
      projects: Map<number, string>;
      totalCount: number;
    }
  >();

  visitProjects(group, (project) => {
    for (const item of project.dependencyVulnerabilities?.items ?? []) {
      if (selectedSeverity && item.severity !== selectedSeverity) {
        continue;
      }

      const currentEntry = entries.get(item.packageName) ?? {
        bySeverity: {},
        packageName: item.packageName,
        projects: new Map<number, string>(),
        totalCount: 0,
      };
      currentEntry.bySeverity[item.severity] = (currentEntry.bySeverity[item.severity] ?? 0) + 1;
      currentEntry.projects.set(project.id, project.name);
      currentEntry.totalCount += 1;
      entries.set(item.packageName, currentEntry);
    }
  });

  return [...entries.values()]
    .map((entry) => ({
      bySeverity: entry.bySeverity,
      packageName: entry.packageName,
      projects: [...entry.projects.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      totalCount: entry.totalCount,
    }))
    .sort(
      (left, right) =>
        right.totalCount - left.totalCount || left.packageName.localeCompare(right.packageName),
    );
}

function projectHasDependencyVulnerabilities(project: ProjectSummary) {
  return (project.dependencyVulnerabilities?.totalCount ?? 0) > 0;
}

function projectHasDependencySeverity(project: ProjectSummary, severity: string) {
  return (project.dependencyVulnerabilities?.bySeverity[severity] ?? 0) > 0;
}

function countProjects(group: GroupNode, predicate: (project: ProjectSummary) => boolean) {
  let total = 0;

  visitProjects(group, (project) => {
    if (predicate(project)) {
      total += 1;
    }
  });

  return total;
}

function visitProjects(group: GroupNode, visitor: (project: ProjectSummary) => void) {
  for (const project of group.projects) {
    visitor(project);
  }

  for (const subgroup of group.subgroups) {
    visitProjects(subgroup, visitor);
  }
}

function primaryLanguageEntries(group: GroupNode) {
  const counts = new Map<string, number>();

  countProjects(group, (project) => {
    const language = project.languages.primary;

    if (!language) {
      return false;
    }

    counts.set(language, (counts.get(language) ?? 0) + 1);
    return false;
  });

  return [...counts.entries()].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
}

function hasPipelineActivityOnDate(project: ProjectSummary, selectedDate: string) {
  return project.pipelineActivity.some(
    (bucket) => bucket.date === selectedDate && bucket.count > 0,
  );
}

type NextRunEntry = {
  project: ProjectSummary;
  schedule: ProjectSummary["schedules"]["upcoming"][number];
};

function collectNextRuns(group: GroupNode): NextRunEntry[] {
  const entries: NextRunEntry[] = [];

  const walk = (node: GroupNode) => {
    for (const project of node.projects) {
      const next = project.schedules.upcoming.find((schedule) => schedule.nextRunAt);
      if (next) {
        entries.push({ project, schedule: next });
      }
    }
    for (const subgroup of node.subgroups) {
      walk(subgroup);
    }
  };

  walk(group);

  return entries.sort((left, right) =>
    String(left.schedule.nextRunAt).localeCompare(String(right.schedule.nextRunAt)),
  );
}

function NextScheduledRuns({
  group,
  onScheduleTriggered,
  runtimeConfig,
}: Readonly<{
  group: GroupNode;
  onScheduleTriggered?: () => void;
  runtimeConfig?: RuntimeConfig | null;
}>) {
  const entries = useMemo(() => collectNextRuns(group), [group]);

  if (!entries.length) {
    return null;
  }

  return (
    <CollapsibleRollup
      detail={`${entries.length} project${entries.length === 1 ? "" : "s"}`}
      title="Next scheduled runs"
    >
      <ul className="next-runs-list">
        {entries.map(({ project, schedule }) => (
          <li className="next-runs-item" key={`${project.id}-${schedule.id}`}>
            <a
              className="next-runs-project"
              href={pipelineSchedulesUrl(project.webUrl)}
              rel="noreferrer"
              target="_blank"
            >
              {project.name}
            </a>
            <span className="next-runs-detail">
              {schedule.description || schedule.ref || `Schedule ${schedule.id}`}
            </span>
            <span className="next-runs-when">{formatScheduleDate(schedule.nextRunAt)}</span>
            <ScheduleRunButton
              onTriggered={onScheduleTriggered}
              projectId={project.id}
              runtimeConfig={runtimeConfig}
              scheduleId={schedule.id}
            />
          </li>
        ))}
      </ul>
    </CollapsibleRollup>
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

