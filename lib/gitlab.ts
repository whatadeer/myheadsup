import type {
  GitLabGroupRef,
  GitLabProjectRef,
  IssueSummary,
  MergeRequestSummary,
  PipelineHistogramBucket,
  PipelineSummary,
  ResolvedSource,
  ScheduleSummary,
  SourceSuggestion,
  SourceKind,
  RuntimeConfig,
} from "./types";
import { createConcurrencyLimiter } from "./concurrency-limit";
import { describeRequestError } from "./request-errors";
import { logServerDebug, logServerError } from "./server-log";

type GitLabGroupResponse = {
  id: number;
  name: string;
  full_path: string;
  web_url: string;
};

type GitLabProjectResponse = {
  id: number;
  name: string;
  path_with_namespace: string;
  web_url: string;
  open_issues_count?: number | null;
};

type GitLabPipelineResponse = {
  status: string;
  ref: string | null;
  updated_at: string | null;
  web_url: string | null;
};

type GitLabMergeRequestResponse = {
  id: number;
  iid: number;
  title: string;
  updated_at: string | null;
  web_url: string;
  assignees?: Array<{
    name?: string | null;
    username?: string | null;
  }> | null;
  reviewers?: Array<{
    name?: string | null;
    username?: string | null;
  }> | null;
};

type GitLabIssueResponse = {
  id: number;
  iid: number;
  title: string;
  updated_at: string | null;
  web_url: string;
};

const PIPELINE_ACTIVITY_DAYS = 14;

type GitLabScheduleResponse = {
  description?: string | null;
  id: number;
  active: boolean;
  next_run_at?: string | null;
  ref?: string | null;
};

const SEARCH_CACHE_TTL_MS = 60_000;
const SEARCH_RESULT_LIMIT = 20;
const runGitLabRequest = createConcurrencyLimiter(6);
const searchCache = new Map<
  string,
  { expiresAt: number; results: SourceSuggestion[] }
>();

export function getGitLabConfigError(runtimeConfig?: RuntimeConfig | null) {
  const baseUrl = runtimeConfig?.gitlabBaseUrl ?? process.env.GITLAB_BASE_URL?.trim() ?? "";
  const token = runtimeConfig?.gitlabToken ?? process.env.GITLAB_TOKEN?.trim() ?? "";

  if (!baseUrl) {
    return "Missing GITLAB_BASE_URL.";
  }

  if (!token) {
    return "Missing GITLAB_TOKEN.";
  }

  return null;
}

export async function resolveSourceReference(
  kind: SourceKind,
  reference: string,
  runtimeConfig?: RuntimeConfig | null,
): Promise<ResolvedSource> {
  if (kind === "group") {
    const group = await fetchGitLab<GitLabGroupResponse>(
      `/groups/${encodeGitLabPath(reference)}`,
      runtimeConfig,
    );

    return {
      gitlabId: group.id,
      name: group.name,
      reference: group.full_path,
      webUrl: group.web_url,
    };
  }

  const project = await fetchGitLab<GitLabProjectResponse>(
    `/projects/${encodeGitLabPath(reference)}`,
    runtimeConfig,
  );

  return {
    gitlabId: project.id,
    name: project.name,
    reference: project.path_with_namespace,
    webUrl: project.web_url,
  };
}

export async function fetchGroupById(
  groupId: number,
  runtimeConfig?: RuntimeConfig | null,
): Promise<GitLabGroupRef> {
  const group = await fetchGitLab<GitLabGroupResponse>(`/groups/${groupId}`, runtimeConfig);

  return {
    id: group.id,
    name: group.name,
    fullPath: group.full_path,
    webUrl: group.web_url,
  };
}

export async function fetchProjectById(
  projectId: number,
  runtimeConfig?: RuntimeConfig | null,
): Promise<GitLabProjectRef> {
  const project = await fetchGitLab<GitLabProjectResponse>(
    `/projects/${projectId}`,
    runtimeConfig,
  );

  return {
    id: project.id,
    name: project.name,
    pathWithNamespace: project.path_with_namespace,
    webUrl: project.web_url,
    openIssuesCount: project.open_issues_count ?? null,
  };
}

export async function fetchGroupProjects(
  groupId: number,
  runtimeConfig?: RuntimeConfig | null,
): Promise<GitLabProjectRef[]> {
  const projects = await fetchAllPages<GitLabProjectResponse>(
    `/groups/${groupId}/projects?include_subgroups=false&with_shared=false&order_by=name&sort=asc&per_page=100`,
    runtimeConfig,
  );

  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    pathWithNamespace: project.path_with_namespace,
    webUrl: project.web_url,
    openIssuesCount: project.open_issues_count ?? null,
  }));
}

export async function fetchSubgroups(
  groupId: number,
  runtimeConfig?: RuntimeConfig | null,
): Promise<GitLabGroupRef[]> {
  const groups = await fetchAllPages<GitLabGroupResponse>(
    `/groups/${groupId}/subgroups?order_by=name&sort=asc&per_page=100`,
    runtimeConfig,
  );

  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    fullPath: group.full_path,
    webUrl: group.web_url,
  }));
}

export async function fetchOpenMergeRequests(
  projectId: number,
  runtimeConfig?: RuntimeConfig | null,
): Promise<{
  count: number;
  items: MergeRequestSummary[];
}> {
  const mergeRequests = await fetchAllPages<GitLabMergeRequestResponse>(
    `/projects/${projectId}/merge_requests?state=opened&order_by=updated_at&sort=desc&per_page=100`,
    runtimeConfig,
  );

  return {
    count: mergeRequests.length,
    items: mergeRequests.map((mergeRequest) => ({
      assigneeNames: extractParticipantNames(mergeRequest.assignees),
      id: mergeRequest.id,
      iid: mergeRequest.iid,
      isUnassigned:
        !mergeRequest.assignees ||
        mergeRequest.assignees.every(
          (assignee) => !assignee.name?.trim() && !assignee.username?.trim(),
        ),
      reviewerNames: extractParticipantNames(mergeRequest.reviewers),
      title: mergeRequest.title,
      updatedAt: mergeRequest.updated_at,
      webUrl: mergeRequest.web_url,
    })),
  };
}

export async function fetchOpenIssues(
  projectId: number,
  runtimeConfig?: RuntimeConfig | null,
): Promise<{
  count: number;
  items: IssueSummary[];
}> {
  const issues = await fetchAllPages<GitLabIssueResponse>(
    `/projects/${projectId}/issues?state=opened&order_by=updated_at&sort=desc&per_page=100`,
    runtimeConfig,
  );

  return {
    count: issues.length,
    items: issues.map((issue) => ({
      id: issue.id,
      iid: issue.iid,
      title: issue.title,
      updatedAt: issue.updated_at,
      webUrl: issue.web_url,
    })),
  };
}

function extractParticipantNames(
  participants?: Array<{
    name?: string | null;
    username?: string | null;
  }> | null,
) {
  return (participants ?? [])
    .map((participant) => participant.name?.trim() || participant.username?.trim() || "")
    .filter((participantName) => participantName.length > 0);
}

export async function fetchLatestPipeline(
  projectId: number,
  runtimeConfig?: RuntimeConfig | null,
): Promise<PipelineSummary | null> {
  const pipelines = await fetchGitLab<GitLabPipelineResponse[]>(
    `/projects/${projectId}/pipelines?per_page=1&order_by=updated_at&sort=desc`,
    runtimeConfig,
  );
  const latest = pipelines[0];

  if (!latest) {
    return null;
  }

  return {
    status: latest.status,
    ref: latest.ref,
    updatedAt: latest.updated_at,
    webUrl: latest.web_url,
  };
}

export async function fetchScheduleSummary(
  projectId: number,
  runtimeConfig?: RuntimeConfig | null,
): Promise<ScheduleSummary> {
  const schedules = await fetchAllPages<GitLabScheduleResponse>(
    `/projects/${projectId}/pipeline_schedules?per_page=100`,
    runtimeConfig,
  );

  return {
    total: schedules.length,
    active: schedules.filter((schedule) => schedule.active).length,
    upcoming: schedules
      .filter((schedule) => schedule.active && schedule.next_run_at)
      .sort((left, right) =>
        String(left.next_run_at).localeCompare(String(right.next_run_at)),
      )
      .slice(0, 10)
      .map((schedule) => ({
        active: schedule.active,
        description: schedule.description ?? null,
        id: schedule.id,
        nextRunAt: schedule.next_run_at ?? null,
        ref: schedule.ref ?? null,
      })),
  };
}

export async function fetchPipelineActivity(
  projectId: number,
  runtimeConfig?: RuntimeConfig | null,
): Promise<PipelineHistogramBucket[]> {
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
  startDate.setDate(startDate.getDate() - (PIPELINE_ACTIVITY_DAYS - 1));

  const params = new URLSearchParams({
    per_page: "100",
    updated_after: startDate.toISOString(),
  });

  const pipelines = await fetchAllPages<GitLabPipelineResponse>(
    `/projects/${projectId}/pipelines?${params.toString()}`,
    runtimeConfig,
  );

  return buildPipelineHistogram(pipelines, startDate, PIPELINE_ACTIVITY_DAYS);
}

export async function searchSourceSuggestions(
  query: string,
  kind?: SourceKind,
  runtimeConfig?: RuntimeConfig | null,
): Promise<SourceSuggestion[]> {
  const normalizedQuery = query.trim();
  const cacheKey = `${getGitLabCacheScope(runtimeConfig)}:${kind ?? "all"}:${normalizedQuery.toLowerCase()}`;
  const cachedResults = getCachedSearchResults(cacheKey);

  if (cachedResults) {
    return cachedResults;
  }

  const results = kind
    ? await safeSearchSuggestionsByKind(kind, normalizedQuery, runtimeConfig)
    : sortSuggestions([
        ...(await safeSearchSuggestionsByKind("group", normalizedQuery, runtimeConfig)),
        ...(await safeSearchSuggestionsByKind("project", normalizedQuery, runtimeConfig)),
      ]).slice(0, SEARCH_RESULT_LIMIT);

  setCachedSearchResults(cacheKey, results);
  return results;
}

export async function resolveSourceSelection(
  reference: string,
  query: string,
  preferredKind?: SourceKind,
  runtimeConfig?: RuntimeConfig | null,
): Promise<SourceSuggestion> {
  const normalizedReference = reference.trim();

  if (preferredKind) {
    return {
      kind: preferredKind,
      ...(await resolveSourceReference(preferredKind, normalizedReference, runtimeConfig)),
    };
  }

  const exactMatches = (await searchSourceSuggestions(query, undefined, runtimeConfig)).filter((suggestion) =>
    matchesReference(suggestion, normalizedReference),
  );

  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  if (exactMatches.length > 1) {
    throw new Error("That matches both a group and a project. Pick the one you want from the list.");
  }

  const [groupMatch, projectMatch] = await Promise.all([
    tryResolveSourceSelection("group", normalizedReference, runtimeConfig),
    tryResolveSourceSelection("project", normalizedReference, runtimeConfig),
  ]);

  if (groupMatch && projectMatch) {
    throw new Error("That matches both a group and a project. Pick the one you want from the list.");
  }

  if (groupMatch) {
    return groupMatch;
  }

  if (projectMatch) {
    return projectMatch;
  }

  throw new Error("No accessible GitLab group or project matched that path or ID.");
}

async function fetchAllPages<T>(path: string, runtimeConfig?: RuntimeConfig | null) {
  const items: T[] = [];
  let nextPath: string | null = path;

  while (nextPath) {
    const response = await fetchGitLabResponse(nextPath, runtimeConfig);
    const pageItems = (await response.json()) as T[];
    items.push(...pageItems);

    const nextPage = response.headers.get("x-next-page");
    nextPath = nextPage ? appendPage(path, nextPage) : null;
  }

  return items;
}

async function fetchGitLab<T>(path: string, runtimeConfig?: RuntimeConfig | null): Promise<T> {
  const response = await fetchGitLabResponse(path, runtimeConfig);
  return (await response.json()) as T;
}

async function fetchGitLabResponse(path: string, runtimeConfig?: RuntimeConfig | null) {
  const configError = getGitLabConfigError(runtimeConfig);

  if (configError) {
    throw new Error(configError);
  }

  const baseUrl = (runtimeConfig?.gitlabBaseUrl ?? process.env.GITLAB_BASE_URL!.trim()).replace(
    /\/+$/,
    "",
  );
  const token = runtimeConfig?.gitlabToken ?? process.env.GITLAB_TOKEN!.trim();
  let response: Response;

  try {
    response = await runGitLabRequest(() =>
      fetch(`${baseUrl}/api/v4${path}`, {
        cache: "no-store",
        headers: {
          "PRIVATE-TOKEN": token,
        },
      }),
    );
  } catch (error) {
    const message = describeRequestError(
      error,
      "Unable to reach GitLab. Check the base URL, token, and network access.",
    );
    logServerError("gitlab-request", new Error(message), {
      path,
      baseUrl,
      stage: "network",
    });
    throw new Error(
      message,
    );
  }

  logServerDebug("gitlab-request", "GitLab request completed", {
    path,
    baseUrl,
    status: response.status,
  });
  if (response.ok) {
    return response;
  }

  const message = await readErrorMessage(response);
  logServerError("gitlab-request", new Error(message), {
    path,
    baseUrl,
    status: response.status,
    statusText: response.statusText,
  });
  throw new Error(message);
}

async function readErrorMessage(response: Response) {
  try {
    const payload = (await response.json()) as { message?: string };
    if (payload.message) {
      return String(payload.message);
    }
  } catch {
    // Ignore JSON parse failures and fall back to the HTTP response text.
  }

  const text = await response.text().catch(() => "");
  return text || `GitLab request failed with ${response.status} ${response.statusText}.`;
}

function appendPage(path: string, page: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}page=${page}`;
}

function encodeGitLabPath(reference: string) {
  return encodeURIComponent(reference.trim());
}

async function searchGroupSuggestions(
  query: string,
  runtimeConfig?: RuntimeConfig | null,
): Promise<SourceSuggestion[]> {
  const params = new URLSearchParams({
    all_available: "false",
    order_by: "name",
    per_page: String(SEARCH_RESULT_LIMIT),
    sort: "asc",
  });

  if (query) {
    params.set("search", query);
  }

  const [groups, exactMatch] = await Promise.all([
    fetchGitLab<GitLabGroupResponse[]>(`/groups?${params.toString()}`, runtimeConfig),
    resolveNumericSuggestion("group", query, runtimeConfig),
  ]);

  return sortSuggestions(
    dedupeSuggestions([
    ...(exactMatch ? [exactMatch] : []),
    ...groups.map((group) => ({
      kind: "group" as const,
      gitlabId: group.id,
      name: group.name,
      reference: group.full_path,
      webUrl: group.web_url,
    })),
    ]),
  );
}

async function searchProjectSuggestions(
  query: string,
  runtimeConfig?: RuntimeConfig | null,
): Promise<SourceSuggestion[]> {
  const params = new URLSearchParams({
    membership: "true",
    per_page: String(SEARCH_RESULT_LIMIT),
    simple: "true",
  });

  if (query) {
    params.set("search", query);
    params.set("sort", "desc");
  } else {
    params.set("order_by", "last_activity_at");
    params.set("sort", "desc");
  }

  const [projects, exactMatch] = await Promise.all([
    fetchGitLab<GitLabProjectResponse[]>(`/projects?${params.toString()}`, runtimeConfig),
    resolveNumericSuggestion("project", query, runtimeConfig),
  ]);

  return sortSuggestions(
    dedupeSuggestions([
    ...(exactMatch ? [exactMatch] : []),
    ...projects.map((project) => ({
      kind: "project" as const,
      gitlabId: project.id,
      name: project.name,
      reference: project.path_with_namespace,
      webUrl: project.web_url,
    })),
    ]),
  );
}

async function resolveNumericSuggestion(
  kind: SourceKind,
  query: string,
  runtimeConfig?: RuntimeConfig | null,
): Promise<SourceSuggestion | null> {
  if (!/^\d+$/.test(query)) {
    return null;
  }

  try {
    const resolved = await resolveSourceReference(kind, query, runtimeConfig);
    return {
      kind,
      ...resolved,
    };
  } catch {
    return null;
  }
}

function dedupeSuggestions(results: SourceSuggestion[]) {
  const seenIds = new Set<string>();

  return results.filter((result) => {
    const cacheKey = `${result.kind}:${result.gitlabId}`;

    if (seenIds.has(cacheKey)) {
      return false;
    }

    seenIds.add(cacheKey);
    return true;
  });
}

function sortSuggestions(results: SourceSuggestion[]) {
  return [...results].sort((left, right) => {
    const referenceOrder = left.reference.localeCompare(right.reference, undefined, {
      numeric: true,
      sensitivity: "base",
    });

    if (referenceOrder !== 0) {
      return referenceOrder;
    }

    if (left.kind !== right.kind) {
      return left.kind === "group" ? -1 : 1;
    }

    return left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function matchesReference(suggestion: SourceSuggestion, reference: string) {
  return (
    suggestion.reference.localeCompare(reference, undefined, { sensitivity: "accent" }) === 0 ||
    String(suggestion.gitlabId) === reference
  );
}

async function tryResolveSourceSelection(
  kind: SourceKind,
  reference: string,
  runtimeConfig?: RuntimeConfig | null,
): Promise<SourceSuggestion | null> {
  try {
    const resolved = await resolveSourceReference(kind, reference, runtimeConfig);

    return {
      kind,
      ...resolved,
    };
  } catch {
    return null;
  }
}

async function searchSuggestionsByKind(
  kind: SourceKind,
  query: string,
  runtimeConfig?: RuntimeConfig | null,
) {
  return kind === "group"
    ? searchGroupSuggestions(query, runtimeConfig)
    : searchProjectSuggestions(query, runtimeConfig);
}

async function safeSearchSuggestionsByKind(
  kind: SourceKind,
  query: string,
  runtimeConfig?: RuntimeConfig | null,
) {
  try {
    return await searchSuggestionsByKind(kind, query, runtimeConfig);
  } catch {
    return [];
  }
}

function getGitLabCacheScope(runtimeConfig?: RuntimeConfig | null) {
  const baseUrl = runtimeConfig?.gitlabBaseUrl ?? process.env.GITLAB_BASE_URL?.trim() ?? "";
  const token = runtimeConfig?.gitlabToken ?? process.env.GITLAB_TOKEN?.trim() ?? "";
  return `${baseUrl.toLowerCase()}|${token}`;
}

function getCachedSearchResults(cacheKey: string) {
  const entry = searchCache.get(cacheKey);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    searchCache.delete(cacheKey);
    return null;
  }

  return entry.results;
}

function setCachedSearchResults(cacheKey: string, results: SourceSuggestion[]) {
  if (searchCache.size >= 100) {
    const oldestKey = searchCache.keys().next().value;

    if (oldestKey) {
      searchCache.delete(oldestKey);
    }
  }

  searchCache.set(cacheKey, {
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
    results,
  });
}

function buildPipelineHistogram(
  pipelines: GitLabPipelineResponse[],
  startDate: Date,
  days: number,
): PipelineHistogramBucket[] {
  const counts = new Map<string, PipelineHistogramBucket>();

  for (let offset = 0; offset < days; offset += 1) {
    const bucketDate = new Date(startDate);
    bucketDate.setDate(startDate.getDate() + offset);
    const date = bucketDate.toISOString().slice(0, 10);
    counts.set(date, { date, count: 0, successCount: 0, failedCount: 0 });
  }

  for (const pipeline of pipelines) {
    if (!pipeline.updated_at) {
      continue;
    }

    const bucketKey = pipeline.updated_at.slice(0, 10);
    const bucket = counts.get(bucketKey);

    if (!bucket) {
      continue;
    }

    bucket.count += 1;

    if (pipeline.status === "success") {
      bucket.successCount += 1;
    }

    if (pipeline.status === "failed") {
      bucket.failedCount += 1;
    }
  }

  return [...counts.values()];
}
