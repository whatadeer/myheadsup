export type SourceKind = "group" | "project";

export type ActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export type RuntimeConfig = {
  gitlabBaseUrl: string;
  gitlabToken: string;
  jiraBaseUrl: string;
  sonarQubeBaseUrl: string;
  sonarQubeToken: string;
};

export type ResolvedSource = {
  gitlabId: number;
  name: string;
  reference: string;
  webUrl: string;
};

export type SourceSuggestion = ResolvedSource & {
  kind: SourceKind;
};

export type SavedSourceExclusion = SourceSuggestion;

export type SavedSourceProjectSonarOverride = {
  gitlabProjectId: number;
  projectReference: string;
  sonarProjectKey: string;
};

export type SavedSourceProjectJiraOverride = {
  gitlabProjectId: number;
  projectReference: string;
  jiraProjectKeys: string[];
};

export type SavedSource = {
  id: string;
  kind: SourceKind;
  gitlabId: number;
  name: string;
  reference: string;
  query: string;
  exclusions: SavedSourceExclusion[];
  projectJiraOverrides: SavedSourceProjectJiraOverride[];
  projectSonarOverrides: SavedSourceProjectSonarOverride[];
  jiraProjectKeys: string[];
  sonarProjectKey: string | null;
  webUrl: string;
  createdAt: string;
};

export type GitLabGroupRef = {
  id: number;
  name: string;
  fullPath: string;
  webUrl: string;
};

export type GitLabProjectRef = {
  id: number;
  name: string;
  pathWithNamespace: string;
  webUrl: string;
  openIssuesCount: number | null;
};

export type PipelineSummary = {
  status: string;
  ref: string | null;
  updatedAt: string | null;
  webUrl: string | null;
};

export type PipelineHistogramBucket = {
  date: string;
  count: number;
  successCount: number;
  failedCount: number;
};

export type MergeRequestSummary = {
  id: number;
  iid: number;
  title: string;
  webUrl: string;
  updatedAt: string | null;
  assigneeNames: string[];
  reviewerNames: string[];
  isUnassigned: boolean;
  isApproved: boolean;
  needsRebase: boolean;
};

export type IssueSummary = {
  id: number;
  iid: number;
  title: string;
  webUrl: string;
  updatedAt: string | null;
};

export type DependencyVulnerabilitySummary = {
  totalCount: number;
  bySeverity: Record<string, number>;
  items: DependencyVulnerabilityItem[];
  issueId: number;
  issueIid: number;
  issueTitle: string;
  issueWebUrl: string;
};

export type DependencyVulnerabilityItem = {
  packageName: string;
  severity: string;
};

export type SonarProjectSummary = {
  projectKey: string;
  dashboardUrl: string;
  qualityGateStatus: "passed" | "failed" | "unknown";
  securityIssues: number | null;
  coverage: number | null;
  coverageHistory: SonarMetricHistoryPoint[];
  bugs: number | null;
  bugHistory: SonarMetricHistoryPoint[];
  vulnerabilities: number | null;
  codeSmells: number | null;
  codeSmellHistory: SonarMetricHistoryPoint[];
  duplicatedLinesDensity: number | null;
};

export type SonarMetricHistoryPoint = {
  analyzedAt: string;
  value: number;
};

export type ScheduleSummary = {
  active: number;
  total: number;
  upcoming: ScheduleWindowEntry[];
};

export type ScheduleWindowEntry = {
  active: boolean;
  description: string | null;
  id: number;
  nextRunAt: string | null;
  ref: string | null;
};

export type ProjectLanguageShare = {
  name: string;
  percentage: number;
};

export type ProjectLanguageSummary = {
  primary: string | null;
  items: ProjectLanguageShare[];
};

export type ProjectSummary = {
  id: number;
  name: string;
  pathWithNamespace: string;
  webUrl: string;
  jiraBaseUrl: string | null;
  jiraProjectKeys: string[];
  sonarProjectKey: string | null;
  openIssues: number;
  issues: IssueSummary[];
  dependencyVulnerabilities: DependencyVulnerabilitySummary | null;
  openMergeRequests: number;
  needsReviewerMergeRequests: number;
  mergeRequests: MergeRequestSummary[];
  sonar: SonarProjectSummary | null;
  schedules: ScheduleSummary;
  languages: ProjectLanguageSummary;
  latestPipeline: PipelineSummary | null;
  pipelineActivity: PipelineHistogramBucket[];
};

export type GroupSummary = {
  projectCount: number;
  openIssues: number;
  openMergeRequests: number;
  needsReviewerMergeRequests: number;
  schedules: ScheduleSummary;
  pipelineStatuses: Record<string, number>;
  pipelineActivity: PipelineHistogramBucket[];
};

export type GroupNode = {
  id: number;
  name: string;
  fullPath: string;
  webUrl: string;
  jiraBaseUrl: string | null;
  projects: ProjectSummary[];
  subgroups: GroupNode[];
  summary: GroupSummary;
};

export type SourceDashboard =
  | {
      kind: "project";
      savedSource: SavedSource;
      project: ProjectSummary;
    }
  | {
      kind: "group";
      savedSource: SavedSource;
      group: GroupNode;
    }
  | {
      savedSource: SavedSource;
      error: string;
    };

export type DashboardSnapshotStatus = "empty" | "fresh" | "stale" | "refreshing";

export type DashboardSnapshotSummary = {
  status: DashboardSnapshotStatus;
  lastUpdatedAt: string | null;
  freshSourceCount: number;
  staleSourceCount: number;
  refreshingSourceCount: number;
  missingSourceCount: number;
};

export type DashboardResponsePayload = {
  dashboards: SourceDashboard[];
  snapshot: DashboardSnapshotSummary;
};

export type ProjectRefreshResponsePayload = {
  dashboard: SourceDashboard;
  message: string;
};
