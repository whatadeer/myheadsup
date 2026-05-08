"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  addSourceAction,
  dismissLastRemovedSourceAction,
  removeSourceAction,
  restoreLastRemovedSourceAction,
  updateGroupDefinitionAction,
} from "@/app/actions";
import { DashboardRefreshStatus } from "@/components/dashboard-refresh-status";
import { GroupTreeFilter } from "@/components/group-tree-filter";
import { JiraProjectLinks } from "@/components/jira-project-links";
import { LoadingStatus } from "@/components/loading-status";
import { ProjectDetailTabs } from "@/components/project-detail-tabs";
import { RuntimeConfigSetup } from "@/components/runtime-config-setup";
import { SourceForm } from "@/components/source-form";
import { formatProjectLanguages } from "@/lib/project-languages";
import { reconcileDashboardsWithSavedSources } from "@/lib/source-dashboard";
import { formatSourceQueryExpanded } from "@/lib/source-query";
import { sanitizeRuntimeConfig } from "@/lib/runtime-config";
import { describeRequestError } from "@/lib/request-errors";
import { labelPipeline, statusTone } from "@/lib/pipeline";
import type {
  ActionState,
  DashboardResponsePayload,
  DashboardSnapshotSummary,
  ProjectRefreshResponsePayload,
  RemovedSourceUndo,
  RuntimeConfig,
  SavedSource,
  SourceDashboard,
} from "@/lib/types";

const runtimeConfigStorageKey = "myheadsup.runtime-config";
const autoRefreshEnabledStorageKey = "myheadsup.auto-refresh-enabled";
const autoRefreshIntervalMs = 90_000;
const backgroundRefreshPollIntervalMs = 3_000;
const manualRefreshCooldownMs = 12_000;
const startupRetryCount = 3;
const startupRetryDelayMs = 1_500;
const runtimeConfigChangeEventName = "myheadsup:runtime-config-change";

type RefreshTrigger = "auto" | "followup" | "initial" | "manual";

type RefreshStatus = {
  detail: string;
  label: string;
};

type HomeContentProps = {
  lastRemovedSource: RemovedSourceUndo | null;
  savedSources: SavedSource[];
  serverConfigError: string | null;
  showDebugUrls: boolean;
  serverUrls: {
    gitlabBaseUrl: string | null;
    jiraBaseUrl: string | null;
    sonarQubeBaseUrl: string | null;
  };
};

export function HomeContent({
  lastRemovedSource,
  savedSources,
  serverConfigError,
  showDebugUrls,
  serverUrls,
}: HomeContentProps) {
  const isHydrated = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const runtimeConfig = useSyncExternalStore(
    subscribeToRuntimeConfig,
    readStoredRuntimeConfigSnapshot,
    () => null,
  );
  const [loadedDashboards, setLoadedDashboards] = useState<SourceDashboard[]>([]);
  const [runtimeDashboardError, setRuntimeDashboardError] = useState("");
  const [runtimeDashboardLoading, setRuntimeDashboardLoading] = useState(false);
  const [backgroundRefreshPending, setBackgroundRefreshPending] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(() =>
    readStoredAutoRefreshEnabled(),
  );
  const [isWindowVisible, setIsWindowVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );
  const [nextRefreshAt, setNextRefreshAt] = useState(0);
  const [manualRefreshAvailableAt, setManualRefreshAvailableAt] = useState(0);
  const [clockNow, setClockNow] = useState(0);
  const [lastDashboardUpdatedAt, setLastDashboardUpdatedAt] = useState<string | null>(null);
  const [refreshStatus, setRefreshStatus] = useState(() => buildIdleRefreshStatus(savedSources.length, null));
  const refreshAbortControllerRef = useRef<AbortController | null>(null);
  const initialLoadAttemptedRef = useRef(false);

  const hasBrowserRuntimeConfig = Boolean(serverConfigError && runtimeConfig);
  const canRefreshDashboards =
    savedSources.length > 0 && (!serverConfigError || hasBrowserRuntimeConfig);
  const dashboards = useMemo(
    () => reconcileDashboardsWithSavedSources(loadedDashboards, savedSources),
    [loadedDashboards, savedSources],
  );
  const showLiveDashboards = serverConfigError ? hasBrowserRuntimeConfig : true;
  const visibleDashboards = showLiveDashboards ? dashboards : [];
  const hasVisibleDashboardData = visibleDashboards.length > 0;
  const manualCooldownRemainingMs = Math.max(manualRefreshAvailableAt - clockNow, 0);
  const effectiveUrls = {
    gitlabBaseUrl: resolveDebugUrl(runtimeConfig?.gitlabBaseUrl, serverUrls.gitlabBaseUrl),
    jiraBaseUrl: resolveDebugUrl(runtimeConfig?.jiraBaseUrl, serverUrls.jiraBaseUrl),
    sonarQubeBaseUrl: resolveDebugUrl(runtimeConfig?.sonarQubeBaseUrl, serverUrls.sonarQubeBaseUrl),
  };

  const loadDashboards = useCallback(
    async (trigger: RefreshTrigger) => {
      if (!canRefreshDashboards || refreshAbortControllerRef.current) {
        return;
      }

      const controller = new AbortController();
      refreshAbortControllerRef.current = controller;

      setRuntimeDashboardLoading(true);
      setRuntimeDashboardError("");
      setRefreshStatus(buildLoadingRefreshStatus(trigger, lastDashboardUpdatedAt));
      setNextRefreshAt(
        autoRefreshEnabled ? Date.now() + autoRefreshIntervalMs : 0,
      );

      const maxAttempts = !hasVisibleDashboardData ? startupRetryCount : 1;

      try {
        let resolvedDashboards: SourceDashboard[] | null = null;
        let resolvedSnapshotSummary = createEmptyDashboardSnapshotSummary();

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            const response = await fetch("/api/dashboard", {
              body: JSON.stringify({
                force: trigger === "manual" || trigger === "auto",
                runtimeConfig,
              }),
              headers: {
                "Content-Type": "application/json",
              },
              method: "POST",
              signal: controller.signal,
            });
            const payload = (await response.json()) as Partial<DashboardResponsePayload> & {
              message?: string;
            };

            if (!response.ok) {
              throw new Error(payload.message || "Unable to load saved source dashboards.");
            }

            resolvedDashboards = payload.dashboards ?? [];
            const nextSnapshotSummary = payload.snapshot ?? createEmptyDashboardSnapshotSummary();
            resolvedSnapshotSummary = nextSnapshotSummary;
            setLastDashboardUpdatedAt(nextSnapshotSummary.lastUpdatedAt);
            setBackgroundRefreshPending(nextSnapshotSummary.status === "refreshing");

            if (!hasVisibleDashboardData) {
              const transientSourceError = getTransientSourceErrorMessage(resolvedDashboards);

              if (transientSourceError) {
                throw new Error(transientSourceError);
              }
            }

            break;
          } catch (error) {
            if (controller.signal.aborted) {
              return;
            }

            const message = describeRequestError(
              error,
              "Unable to load the dashboard right now. Check the saved GitLab URL, token, and network access.",
            );

            if (attempt < maxAttempts) {
              const retryDelay = startupRetryDelayMs * attempt;
              setRefreshStatus(
                createRefreshStatus(
                  `Retrying in ${formatCountdown(retryDelay)}`,
                  `${message} Retrying in ${formatCountdown(retryDelay)} (${attempt + 1}/${maxAttempts}).`,
                ),
              );
              await waitForRetry(retryDelay, controller.signal);
              continue;
            }

            throw new Error(message);
          }
        }

        if (resolvedDashboards === null) {
          throw new Error("Unable to load saved source dashboards.");
        }

        let preservedErrorCount = 0;

        setLoadedDashboards((currentDashboards) => {
          const { dashboards: nextDashboards, preservedCount } = mergeDashboardsPreservingSuccess(
            currentDashboards,
            resolvedDashboards,
          );
          preservedErrorCount = preservedCount;
          return nextDashboards;
        });

        if (preservedErrorCount > 0) {
          const sourceLabel = preservedErrorCount === 1 ? "source" : "sources";
          const message = `GitLab had a temporary issue during refresh. Keeping the previous data for ${preservedErrorCount} ${sourceLabel}.`;
          setRuntimeDashboardError(message);
          setRefreshStatus(
            lastDashboardUpdatedAt
              ? createLastUpdatedRefreshStatus(lastDashboardUpdatedAt, message)
              : createRefreshStatus("Using previous data.", message),
          );
          return;
        }

        setRuntimeDashboardError("");
        setRefreshStatus(buildDashboardRefreshStatus(trigger, resolvedSnapshotSummary));
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        const message = describeRequestError(
          error,
          "Unable to load the dashboard right now. Check the saved GitLab URL, token, and network access.",
        );
        setBackgroundRefreshPending(false);
        setRuntimeDashboardError(message);
        setRefreshStatus(
          lastDashboardUpdatedAt
            ? createLastUpdatedRefreshStatus(lastDashboardUpdatedAt, message)
            : createRefreshStatus("Refresh failed.", message),
        );
      } finally {
        if (refreshAbortControllerRef.current === controller) {
          refreshAbortControllerRef.current = null;
        }

        if (!controller.signal.aborted) {
          setRuntimeDashboardLoading(false);
        }
      }
    },
    [
      autoRefreshEnabled,
      canRefreshDashboards,
      hasVisibleDashboardData,
      lastDashboardUpdatedAt,
      runtimeConfig,
    ],
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setClockNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    function handleVisibilityChange() {
      setIsWindowVisible(document.visibilityState === "visible");
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    return () => {
      refreshAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (!canRefreshDashboards) {
      initialLoadAttemptedRef.current = false;
      return;
    }

    if (hasVisibleDashboardData) {
      return;
    }

    if (
      !isHydrated ||
      runtimeDashboardLoading ||
      !isWindowVisible ||
      initialLoadAttemptedRef.current
    ) {
      return;
    }

    initialLoadAttemptedRef.current = true;

    const timeoutId = window.setTimeout(() => {
      void loadDashboards("initial");
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    canRefreshDashboards,
    hasVisibleDashboardData,
    isHydrated,
    isWindowVisible,
    loadDashboards,
    runtimeDashboardLoading,
  ]);

  useEffect(() => {
    if (
      !isHydrated ||
      !autoRefreshEnabled ||
      !canRefreshDashboards ||
      runtimeDashboardLoading ||
      !isWindowVisible ||
      !hasVisibleDashboardData
    ) {
      return;
    }

    if (nextRefreshAt <= 0) {
      const timeoutId = window.setTimeout(() => {
        const now = Date.now();
        setClockNow(now);
        setNextRefreshAt(now + autoRefreshIntervalMs);
      }, 0);

      return () => {
        window.clearTimeout(timeoutId);
      };
    }

    const timeoutId = window.setTimeout(() => {
      void loadDashboards(hasVisibleDashboardData ? "auto" : "initial");
    }, Math.max(nextRefreshAt - Date.now(), 0));

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    isHydrated,
    autoRefreshEnabled,
    canRefreshDashboards,
    hasVisibleDashboardData,
    isWindowVisible,
    loadDashboards,
    nextRefreshAt,
    runtimeDashboardLoading,
  ]);

  useEffect(() => {
    if (
      !isHydrated ||
      !backgroundRefreshPending ||
      !canRefreshDashboards ||
      runtimeDashboardLoading ||
      !isWindowVisible
    ) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadDashboards("followup");
    }, backgroundRefreshPollIntervalMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    backgroundRefreshPending,
    canRefreshDashboards,
    isHydrated,
    isWindowVisible,
    loadDashboards,
    runtimeDashboardLoading,
  ]);

  function handleSaveRuntimeConfig(nextValue: RuntimeConfig) {
    window.localStorage.setItem(runtimeConfigStorageKey, JSON.stringify(nextValue));
    notifyRuntimeConfigChange();
    initialLoadAttemptedRef.current = false;
    setBackgroundRefreshPending(false);
    setRuntimeDashboardError("");
    setNextRefreshAt(autoRefreshEnabled ? Date.now() : 0);
    setRefreshStatus(buildIdleRefreshStatus(savedSources.length, lastDashboardUpdatedAt));
  }

  function handleClearRuntimeConfig() {
    refreshAbortControllerRef.current?.abort();
    initialLoadAttemptedRef.current = false;
    window.localStorage.removeItem(runtimeConfigStorageKey);
    notifyRuntimeConfigChange();
    setRuntimeDashboardLoading(false);
    setBackgroundRefreshPending(false);
    setRuntimeDashboardError("");
    setLoadedDashboards([]);
    setLastDashboardUpdatedAt(null);
    setNextRefreshAt(0);
    setRefreshStatus(createRefreshStatus("Save browser settings."));
  }

  function handleManualRefresh() {
    if (runtimeDashboardLoading || manualCooldownRemainingMs > 0) {
      return;
    }

    setManualRefreshAvailableAt(Date.now() + manualRefreshCooldownMs);
    void loadDashboards(hasVisibleDashboardData ? "manual" : "initial");
  }

  function handleToggleAutoRefresh() {
    const nextValue = !autoRefreshEnabled;

    setAutoRefreshEnabled(nextValue);
    window.localStorage.setItem(autoRefreshEnabledStorageKey, JSON.stringify(nextValue));
    setNextRefreshAt(nextValue ? Date.now() : 0);
    setRefreshStatus(buildIdleRefreshStatus(savedSources.length, lastDashboardUpdatedAt));
  }

  const handleScheduleTriggered = useCallback(() => {
    if (!canRefreshDashboards) {
      return;
    }

    void loadDashboards(hasVisibleDashboardData ? "manual" : "initial");
  }, [canRefreshDashboards, hasVisibleDashboardData, loadDashboards]);

  const handleProjectReload = useCallback(
    async (sourceId: string, projectId: number, projectName: string): Promise<ActionState> => {
      if (!canRefreshDashboards) {
        return {
          status: "error",
          message: "Live refresh is not available right now.",
        };
      }

      try {
        const response = await fetch("/api/dashboard/project", {
          body: JSON.stringify({
            projectId,
            runtimeConfig,
            sourceId,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        });
        const payload = (await response.json()) as Partial<ProjectRefreshResponsePayload> & {
          message?: string;
        };

        if (!response.ok || !payload.dashboard) {
          throw new Error(payload.message || "Unable to reload that project.");
        }

        const refreshedAt = new Date().toISOString();
        setLoadedDashboards((currentDashboards) =>
          replaceDashboardBySourceId(currentDashboards, payload.dashboard!),
        );
        setLastDashboardUpdatedAt(refreshedAt);
        setRuntimeDashboardError("");
        setBackgroundRefreshPending(false);
        setNextRefreshAt(autoRefreshEnabled ? Date.now() + autoRefreshIntervalMs : 0);
        setRefreshStatus(
          createLastUpdatedRefreshStatus(
            refreshedAt,
            `Reloaded ${projectName} at ${formatSnapshotTimestamp(refreshedAt)}.`,
          ),
        );

        return {
          status: "success",
          message: payload.message || `Reloaded ${projectName}.`,
        };
      } catch (error) {
        return {
          status: "error",
          message: describeRequestError(error, `Unable to reload ${projectName} right now.`),
        };
      }
    },
    [autoRefreshEnabled, canRefreshDashboards, runtimeConfig],
  );

  return (
    <main className="shell">
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-integrations" aria-label="Integrated sources">
            <HeroIntegrationChip
              href={effectiveUrls.gitlabBaseUrl}
              kind="gitlab"
              label="GitLab"
              shortLabel="GL"
            />
            <HeroIntegrationChip
              href={effectiveUrls.jiraBaseUrl}
              kind="jira"
              label="Jira"
              shortLabel="JR"
            />
            <HeroIntegrationChip
              href={effectiveUrls.sonarQubeBaseUrl}
              kind="sonar"
              label="SonarQube"
              shortLabel="SQ"
            />
          </div>
          <h1>MyHeadsUp</h1>
          <p>
            Keep a single top-level view of the GitLab groups and projects you care
            about most. Group entries stay nested, project rows stay compact, and
            the page focuses on what needs attention right now.
          </p>
        </div>
      </section>

      <details className="panel setup-panel" open={!savedSources.length || Boolean(serverConfigError)}>
        <summary className="setup-panel-summary">
          <div>
            <h2>
              {serverConfigError ? "Configure access and add a group or project" : "Add a group or project"}
            </h2>
            <p>
              {serverConfigError ? (
                "Save GitLab access in this browser or provide server env vars, then search the groups and projects you can access."
              ) : (
                <>
                  Search the GitLab groups and projects you can access in one combined
                  picker, or enter a full path like <code>platform/api</code> or a
                  numeric GitLab ID.
                </>
              )}
            </p>
          </div>
          <span className="setup-panel-toggle" aria-hidden="true">
            Toggle
          </span>
        </summary>

        <div className="setup-panel-body">
          {serverConfigError ? (
            <RuntimeConfigSetup
              key={runtimeConfig ? JSON.stringify(runtimeConfig) : "empty"}
              currentValue={runtimeConfig}
              onClear={handleClearRuntimeConfig}
              onSave={handleSaveRuntimeConfig}
              requireGitLab
              serverConfigError={serverConfigError}
            />
          ) : null}
          {serverConfigError && !hasBrowserRuntimeConfig ? (
            <div className="notice setup-prompt">
              Save browser settings above to unlock GitLab search and dashboard loading in
              this browser.
            </div>
          ) : (
            <SourceForm action={addSourceAction} runtimeConfig={runtimeConfig} />
          )}
        </div>
      </details>

      {lastRemovedSource ? (
        <UndoRemovedSourceNotice lastRemovedSource={lastRemovedSource} />
      ) : null}

      {!savedSources.length ? (
        <section className="panel empty-state">
          <h2>No saved sources yet</h2>
          <p>Add a group or project above to start building your dashboard.</p>
        </section>
      ) : serverConfigError && !hasBrowserRuntimeConfig ? (
        <SavedSourcesList savedSources={savedSources} subtitle="Finish the browser setup above to load live GitLab data." />
      ) : runtimeDashboardError && !hasVisibleDashboardData ? (
        <SavedSourcesList savedSources={savedSources} subtitle={runtimeDashboardError} subtitleClassName="error-text" />
      ) : runtimeDashboardLoading && !hasVisibleDashboardData ? (
        <section className="panel empty-state">
          <LoadingStatus
            description={`Loading ${savedSources.length} saved ${savedSources.length === 1 ? "source" : "sources"} with your browser settings.`}
            stages={[
              "Checking the saved browser settings.",
              "Connecting to GitLab and loading saved sources.",
              "Collecting project and group details.",
              "Finalizing the dashboard view.",
            ]}
            title="Loading saved sources"
          />
        </section>
      ) : (
          <section className="dashboard-list">
            {visibleDashboards.map((dashboard) => (
              <SourceCard
                dashboard={dashboard}
                key={dashboard.savedSource.id}
                onReloadProject={handleProjectReload}
                onScheduleTriggered={handleScheduleTriggered}
                runtimeConfig={runtimeConfig}
              />
            ))}
          </section>
      )}

      {isHydrated && canRefreshDashboards ? (
        <DashboardRefreshStatus
          autoRefreshEnabled={autoRefreshEnabled}
          isLoading={runtimeDashboardLoading}
          manualCooldownRemainingMs={manualCooldownRemainingMs}
          onRefresh={handleManualRefresh}
          onToggleAutoRefresh={handleToggleAutoRefresh}
          statusDetail={refreshStatus.detail}
          statusLabel={refreshStatus.label}
        />
      ) : null}

      {showDebugUrls ? (
        <details className="debug-dock">
          <summary className="debug-dock-summary">Debug URLs</summary>
          <div className="debug-dock-body">
            <p className="helper-text">URLs only. Tokens are never shown here.</p>
            <DebugUrlRow
              label="Server GitLab"
              value={serverUrls.gitlabBaseUrl}
            />
            <DebugUrlRow
              label="Browser GitLab"
              value={runtimeConfig?.gitlabBaseUrl ?? null}
            />
            <DebugUrlRow
              label="Effective GitLab"
              value={effectiveUrls.gitlabBaseUrl}
            />
            <DebugUrlRow
              label="Server Jira"
              value={serverUrls.jiraBaseUrl}
            />
            <DebugUrlRow
              label="Browser Jira"
              value={runtimeConfig?.jiraBaseUrl ?? null}
            />
            <DebugUrlRow
              label="Effective Jira"
              value={effectiveUrls.jiraBaseUrl}
            />
            <DebugUrlRow
              label="Server Sonar"
              value={serverUrls.sonarQubeBaseUrl}
            />
            <DebugUrlRow
              label="Browser Sonar"
              value={runtimeConfig?.sonarQubeBaseUrl ?? null}
            />
            <DebugUrlRow
              label="Effective Sonar"
              value={effectiveUrls.sonarQubeBaseUrl}
            />
          </div>
        </details>
      ) : null}
    </main>
  );
}

function DebugUrlRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="debug-dock-row">
      <span className="debug-dock-label">{label}</span>
      <code className="debug-dock-value">{value?.trim() || "unset"}</code>
    </div>
  );
}

function resolveDebugUrl(runtimeValue: string | null | undefined, serverValue: string | null) {
  const normalizedRuntimeValue = runtimeValue?.trim() ?? "";
  if (normalizedRuntimeValue) {
    return normalizedRuntimeValue;
  }

  return serverValue;
}

function HeroIntegrationChip({
  href,
  kind,
  label,
  shortLabel,
}: {
  href: string | null;
  kind: "gitlab" | "jira" | "sonar";
  label: string;
  shortLabel: string;
}) {
  const className = `hero-integration hero-integration-${kind}`;
  const content = (
    <>
      <span className="hero-integration-icon" aria-hidden="true">{shortLabel}</span>
      {label}
    </>
  );

  if (!href) {
    return <span className={className}>{content}</span>;
  }

  return (
    <a className={className} href={href} rel="noreferrer" target="_blank">
      {content}
    </a>
  );
}

function readStoredRuntimeConfig() {
  if (typeof window === "undefined") {
    return null;
  }

  const storedValue = window.localStorage.getItem(runtimeConfigStorageKey);

  if (!storedValue) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(storedValue) as RuntimeConfig;
    return sanitizeRuntimeConfig(parsedValue);
  } catch {
    window.localStorage.removeItem(runtimeConfigStorageKey);
    return null;
  }
}

function readStoredRuntimeConfigSnapshot() {
  return readStoredRuntimeConfig();
}

function readStoredAutoRefreshEnabled() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(autoRefreshEnabledStorageKey) === "true";
}

function subscribeToRuntimeConfig(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  function handleChange() {
    onStoreChange();
  }

  window.addEventListener("storage", handleChange);
  window.addEventListener(runtimeConfigChangeEventName, handleChange);

  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(runtimeConfigChangeEventName, handleChange);
  };
}

function notifyRuntimeConfigChange() {
  window.dispatchEvent(new Event(runtimeConfigChangeEventName));
}

function subscribeToHydration() {
  return () => undefined;
}

function formatCountdown(valueMs: number) {
  const totalSeconds = Math.max(1, Math.ceil(valueMs / 1000));
  return `${totalSeconds}s`;
}

function createEmptyDashboardSnapshotSummary(): DashboardSnapshotSummary {
  return {
    status: "empty",
    lastUpdatedAt: null,
    freshSourceCount: 0,
    staleSourceCount: 0,
    refreshingSourceCount: 0,
    missingSourceCount: 0,
  };
}

function createRefreshStatus(
  label: string,
  detail = label,
): RefreshStatus {
  return {
    detail,
    label,
  };
}

function buildIdleRefreshStatus(savedSourceCount: number, lastUpdatedAt: string | null) {
  if (lastUpdatedAt) {
    return createLastUpdatedRefreshStatus(
      lastUpdatedAt,
      `Dashboard updated at ${formatSnapshotTimestamp(lastUpdatedAt)}.`,
    );
  }

  if (!savedSourceCount) {
    return createRefreshStatus("Add a saved source.");
  }

  return createRefreshStatus("Ready to refresh.");
}

function createLastUpdatedRefreshStatus(lastUpdatedAt: string, detail: string) {
  return createRefreshStatus(
    `Last updated ${formatRefreshTimestamp(lastUpdatedAt)}`,
    detail,
  );
}

function buildLoadingRefreshStatus(trigger: RefreshTrigger, lastUpdatedAt: string | null) {
  if (lastUpdatedAt) {
    return createLastUpdatedRefreshStatus(
      lastUpdatedAt,
      trigger === "followup"
        ? `Checking for the latest refresh. Current snapshot is from ${formatSnapshotTimestamp(lastUpdatedAt)}.`
        : `Refreshing now. Current snapshot is from ${formatSnapshotTimestamp(lastUpdatedAt)}.`,
    );
  }

  return createRefreshStatus(
    trigger === "initial" ? "Loading dashboard." : "Refreshing now.",
  );
}

function buildDashboardRefreshStatus(
  trigger: RefreshTrigger,
  snapshotSummary: DashboardSnapshotSummary,
) {
  if (snapshotSummary.status === "refreshing") {
    if (snapshotSummary.lastUpdatedAt) {
      return createLastUpdatedRefreshStatus(
        snapshotSummary.lastUpdatedAt,
        `Showing the last saved snapshot from ${formatSnapshotTimestamp(snapshotSummary.lastUpdatedAt)} while a background refresh runs.`,
      );
    }

    return createRefreshStatus(
      "Refreshing in the background.",
      "Refreshing the dashboard in the background.",
    );
  }

  if (snapshotSummary.status === "stale") {
    if (snapshotSummary.lastUpdatedAt) {
      return createLastUpdatedRefreshStatus(
        snapshotSummary.lastUpdatedAt,
        `Showing the last saved snapshot from ${formatSnapshotTimestamp(snapshotSummary.lastUpdatedAt)}.`,
      );
    }

    return createRefreshStatus(
      "Showing the saved snapshot.",
      "Showing the last saved snapshot.",
    );
  }

  if (trigger === "manual") {
    return snapshotSummary.lastUpdatedAt
      ? createLastUpdatedRefreshStatus(
          snapshotSummary.lastUpdatedAt,
          `Dashboard refreshed at ${formatSnapshotTimestamp(snapshotSummary.lastUpdatedAt)}.`,
        )
      : createRefreshStatus("Refresh complete.", "Dashboard refreshed manually.");
  }

  if (trigger === "followup") {
    return snapshotSummary.lastUpdatedAt
      ? createLastUpdatedRefreshStatus(
          snapshotSummary.lastUpdatedAt,
          `Background refresh complete. Updated at ${formatSnapshotTimestamp(snapshotSummary.lastUpdatedAt)}.`,
        )
      : createRefreshStatus("Refresh complete.", "Background refresh complete.");
  }

  if (trigger === "initial") {
    return snapshotSummary.lastUpdatedAt
      ? createLastUpdatedRefreshStatus(
          snapshotSummary.lastUpdatedAt,
          `Live dashboard loaded at ${formatSnapshotTimestamp(snapshotSummary.lastUpdatedAt)}.`,
        )
      : createRefreshStatus("Dashboard loaded.", "Live dashboard loaded.");
  }

  return snapshotSummary.lastUpdatedAt
    ? createLastUpdatedRefreshStatus(
        snapshotSummary.lastUpdatedAt,
        `Automatic refresh complete. Updated at ${formatSnapshotTimestamp(snapshotSummary.lastUpdatedAt)}.`,
      )
    : createRefreshStatus("Refresh complete.", "Automatic refresh complete.");
}

function formatSnapshotTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "the latest successful refresh";
  }

  return parsed.toLocaleString();
}

function formatRefreshTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "recently";
  }

  const today = new Date();
  const isSameDay =
    parsed.getFullYear() === today.getFullYear() &&
    parsed.getMonth() === today.getMonth() &&
    parsed.getDate() === today.getDate();

  if (isSameDay) {
    return parsed.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return parsed.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function mergeDashboardsPreservingSuccess(
  currentDashboards: SourceDashboard[],
  nextDashboards: SourceDashboard[],
) {
  if (!currentDashboards.length) {
    return {
      dashboards: nextDashboards,
      preservedCount: 0,
    };
  }

  const currentBySourceId = new Map(
    currentDashboards.map((dashboard) => [dashboard.savedSource.id, dashboard]),
  );
  let preservedCount = 0;

  return {
    dashboards: nextDashboards.map((dashboard) => {
      if (!("error" in dashboard)) {
        return dashboard;
      }

      const previousDashboard = currentBySourceId.get(dashboard.savedSource.id);

      if (!previousDashboard || "error" in previousDashboard) {
        return dashboard;
      }

      preservedCount += 1;
      return previousDashboard;
    }),
    preservedCount,
  };
}

function replaceDashboardBySourceId(
  dashboards: SourceDashboard[],
  nextDashboard: SourceDashboard,
) {
  return dashboards.map((dashboard) =>
    dashboard.savedSource.id === nextDashboard.savedSource.id ? nextDashboard : dashboard,
  );
}

function getTransientSourceErrorMessage(dashboards: SourceDashboard[]) {
  for (const dashboard of dashboards) {
    if (!("error" in dashboard)) {
      continue;
    }

    if (isTransientSourceError(dashboard.error)) {
      return dashboard.error;
    }
  }

  return null;
}

function isTransientSourceError(message: string) {
  return /Unable to reach (GitLab|SonarQube)\./i.test(message);
}

function waitForRetry(delayMs: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);

    function cleanup() {
      window.clearTimeout(timeoutId);
      signal.removeEventListener("abort", handleAbort);
    }

    function handleAbort() {
      cleanup();
      reject(new Error("Retry aborted."));
    }

    signal.addEventListener("abort", handleAbort);
  });
}

function SavedSourcesList({
  savedSources,
  subtitle,
  subtitleClassName,
}: {
  savedSources: SavedSource[];
  subtitle: string;
  subtitleClassName?: string;
}) {
  return (
    <section className="panel source-card">
      <div className="summary-stack">
        <h2>Saved sources</h2>
        <p className={subtitleClassName ?? "helper-text"}>{subtitle}</p>
      </div>
      <div className="saved-source-list">
        {savedSources.map((source) => (
          <div className="saved-source-row" key={source.id}>
            <div className="summary-stack">
              <div className="title-row">
                <strong>{source.name}</strong>
                <span className="badge">{source.kind}</span>
              </div>
              <p className="source-query">{source.query}</p>
              <span className="source-subtitle">{source.reference}</span>
            </div>
            <RemoveSourceButton sourceId={source.id} />
          </div>
        ))}
      </div>
    </section>
  );
}

function SourceCard({
  dashboard,
  onReloadProject,
  onScheduleTriggered,
  runtimeConfig,
}: {
  dashboard: SourceDashboard;
  onReloadProject: (sourceId: string, projectId: number, projectName: string) => Promise<ActionState>;
  onScheduleTriggered: () => void;
  runtimeConfig?: RuntimeConfig | null;
}) {
  const [isDefinitionOpen, setIsDefinitionOpen] = useState(false);

  if ("error" in dashboard) {
    return (
      <article className="panel source-card">
        <div className="source-header">
          <div className="source-header-main">
            <div className="title-row">
              <h2>{dashboard.savedSource.name}</h2>
              <span className="badge">{dashboard.savedSource.kind}</span>
              {dashboard.savedSource.kind === "group" ? (
                <DefinitionToggleButton
                  isOpen={isDefinitionOpen}
                  onClick={() => setIsDefinitionOpen((open) => !open)}
                />
              ) : null}
            </div>
            {dashboard.savedSource.kind === "group" ? (
              isDefinitionOpen ? (
                <SourceQueryDisclosure
                  editable
                  label="Group definition"
                  query={dashboard.savedSource.query}
                  sourceId={dashboard.savedSource.id}
                />
              ) : null
            ) : (
              <p className="source-query">{dashboard.savedSource.query}</p>
            )}
            <p className="source-subtitle">{dashboard.savedSource.reference}</p>
          </div>
          <RemoveSourceButton sourceId={dashboard.savedSource.id} />
        </div>
        <p className="error-text">{dashboard.error}</p>
      </article>
    );
  }

  if (dashboard.kind === "project") {
    return (
      <ProjectSourceCard
        dashboard={dashboard}
        onReloadProject={onReloadProject}
        onScheduleTriggered={onScheduleTriggered}
        runtimeConfig={runtimeConfig}
      />
    );
  }

  return (
    <GroupSourceCard
      dashboard={dashboard}
      onReloadProject={onReloadProject}
      onScheduleTriggered={onScheduleTriggered}
      runtimeConfig={runtimeConfig}
    />
  );
}

function ProjectSourceCard({
  dashboard,
  onReloadProject,
  onScheduleTriggered,
  runtimeConfig,
}: {
  dashboard: Extract<SourceDashboard, { kind: "project" }>;
  onReloadProject: (sourceId: string, projectId: number, projectName: string) => Promise<ActionState>;
  onScheduleTriggered: () => void;
  runtimeConfig?: RuntimeConfig | null;
}) {
  const { project, savedSource } = dashboard;

  return (
    <article className="panel source-card">
      <div className="source-header">
        <div className="source-header-main">
          <div className="title-row">
            <h2>{project.name}</h2>
            <span className="badge">project</span>
          </div>
          <p className="source-query">{savedSource.query}</p>
          <p className="source-subtitle">
            <a className="link" href={project.webUrl} rel="noreferrer" target="_blank">
              {project.pathWithNamespace}
            </a>
          </p>
          <p className="project-language-summary">
            Languages: {formatProjectLanguages(project.languages)}
          </p>
          <JiraProjectLinks
            baseUrl={project.jiraBaseUrl}
            jiraProjectKeys={project.jiraProjectKeys}
            label="Jira projects"
          />
        </div>
        <div className="source-header-actions">
          <span className={`status-pill ${statusTone(project.latestPipeline?.status)}`}>
            {labelPipeline(project.latestPipeline?.status)}
          </span>
          <RemoveSourceButton sourceId={savedSource.id} />
        </div>
      </div>

      <ProjectDetailTabs
        onReloadProject={() => onReloadProject(savedSource.id, project.id, project.name)}
        onScheduleTriggered={onScheduleTriggered}
        project={project}
        runtimeConfig={runtimeConfig}
        sourceId={savedSource.id}
      />
    </article>
  );
}

function GroupSourceCard({
  dashboard,
  onReloadProject,
  onScheduleTriggered,
  runtimeConfig,
}: {
  dashboard: Extract<SourceDashboard, { kind: "group" }>;
  onReloadProject: (sourceId: string, projectId: number, projectName: string) => Promise<ActionState>;
  onScheduleTriggered: () => void;
  runtimeConfig?: RuntimeConfig | null;
}) {
  const [isDefinitionOpen, setIsDefinitionOpen] = useState(false);
  const { group, savedSource } = dashboard;

  return (
    <article className="panel source-card">
      <div className="source-header">
        <div className="source-header-main">
          <div className="title-row">
            <h2>{group.name}</h2>
            <span className="badge">group</span>
            <DefinitionToggleButton
              isOpen={isDefinitionOpen}
              onClick={() => setIsDefinitionOpen((open) => !open)}
            />
          </div>
          {isDefinitionOpen ? (
            <SourceQueryDisclosure
              editable
              label="Group definition"
              query={savedSource.query}
              sourceId={savedSource.id}
            />
          ) : null}
          <div className="meta-list">
            <span>{group.summary.projectCount} projects tracked</span>
            <span>{group.subgroups.length} nested groups</span>
          </div>
        </div>
        <RemoveSourceButton sourceId={savedSource.id} />
      </div>

      <GroupTreeFilter
        group={group}
        onReloadProject={(projectId, projectName) =>
          onReloadProject(savedSource.id, projectId, projectName)
        }
        onScheduleTriggered={onScheduleTriggered}
        runtimeConfig={runtimeConfig}
        sourceId={savedSource.id}
      />
    </article>
  );
}

const initialActionState: ActionState = {
  status: "idle" as const,
  message: "",
};

function RemoveSourceButton({ sourceId }: { sourceId: string }) {
  return (
    <form action={removeSourceAction}>
      <input name="sourceId" type="hidden" value={sourceId} />
      <button aria-label="Remove saved source" className="icon-button" type="submit">
        Remove
      </button>
    </form>
  );
}

function UndoRemovedSourceNotice({
  lastRemovedSource,
}: {
  lastRemovedSource: RemovedSourceUndo;
}) {
  const [state, formAction, pending] = useActionState(
    restoreLastRemovedSourceAction,
    initialActionState,
  );
  const sourceLabel = lastRemovedSource.source.kind === "group" ? "group" : "project";

  return (
    <section aria-live="polite" className="panel undo-notice">
      <div className="undo-notice-body">
        <div className="undo-notice-copy">
          <span className="undo-notice-title">
            Removed {lastRemovedSource.source.name} from your saved {sourceLabel} list.
          </span>
          <span className="helper-text">
            Undo restores the saved query, exclusions, and project overrides.
          </span>
        </div>
        <div className="undo-notice-actions">
          <form action={formAction}>
            <button className="button undo-notice-undo" disabled={pending} type="submit">
              {pending ? "Restoring..." : "Undo"}
            </button>
          </form>
          <form action={dismissLastRemovedSourceAction}>
            <button className="subtle-action-button" disabled={pending} type="submit">
              Dismiss
            </button>
          </form>
        </div>
      </div>
      {state.message ? <span className={`form-message ${state.status}`}>{state.message}</span> : null}
    </section>
  );
}

function DefinitionToggleButton({
  isOpen,
  onClick,
}: {
  isOpen: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-expanded={isOpen}
      aria-label={isOpen ? "Hide group definition" : "Show group definition"}
      className={`definition-toggle-button ${isOpen ? "open" : ""}`}
      onClick={onClick}
      title={isOpen ? "Hide group definition" : "Show group definition"}
      type="button"
    >
      <span aria-hidden="true">i</span>
    </button>
  );
}

function SourceQueryDisclosure({
  editable = false,
  label,
  query,
  sourceId,
}: {
  editable?: boolean;
  label: string;
  query: string;
  sourceId?: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [displayMode, setDisplayMode] = useState<"compact" | "expanded">("compact");
  const [isEditing, setIsEditing] = useState(false);
  const [draftQuery, setDraftQuery] = useState(query);
  const displayedQuery = displayMode === "expanded" ? formatSourceQueryExpanded(query) : query;
  const [state, formAction, pending] = useActionState(
    async (previousState: typeof initialActionState, formData: FormData) => {
      const nextState = await updateGroupDefinitionAction(previousState, formData);

      if (nextState.status === "success") {
        setIsEditing(false);
      }

      return nextState;
    },
    initialActionState,
  );

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(displayedQuery);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 2000);
    }
  }

  return (
    <section className="source-query-disclosure">
      <div className="source-query-card-header">
        <div className="source-query-heading-stack">
          <span className="source-query-heading">{label}</span>
          <span className="source-query-caption">
            {editable && sourceId
              ? "Copy or edit the saved definition that controls this group."
              : "Saved definition"}
          </span>
        </div>
        {!isEditing ? (
          <div className="source-query-actions-main source-query-heading-actions">
            {editable && sourceId ? (
              <button
                className="subtle-action-button"
                onClick={() =>
                  setDisplayMode((currentMode) =>
                    currentMode === "compact" ? "expanded" : "compact",
                  )
                }
                type="button"
              >
                {displayMode === "compact" ? "Expanded" : "Compact"}
              </button>
            ) : null}
            <button className="subtle-action-button" onClick={handleCopy} type="button">
              <span aria-hidden="true">Copy</span>
              <span className="sr-only"> group definition</span>
            </button>
            {editable && sourceId ? (
              <button
                className="subtle-action-button"
                onClick={() => {
                  setDraftQuery(displayedQuery);
                  setIsEditing(true);
                }}
                type="button"
              >
                <span aria-hidden="true">Edit</span>
                <span className="sr-only"> group definition</span>
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {isEditing && editable && sourceId ? (
        <form action={formAction} className="source-query-edit-form">
          <input name="sourceId" type="hidden" value={sourceId} />
          <textarea
            className="input source-query-preview source-query-editor"
            name="sourceQueryDefinition"
            onChange={(event) => setDraftQuery(event.target.value)}
            rows={Math.max(draftQuery.split("\n").length + 1, 6)}
            spellCheck={false}
            value={draftQuery}
          />
          <div className="source-query-actions">
            <div className="source-query-actions-main">
              <button className="subtle-action-button" disabled={pending} type="submit">
                {pending ? "Saving..." : "Save"}
              </button>
              <button
                className="subtle-action-button"
                disabled={pending}
                onClick={() => {
                  setDraftQuery(displayedQuery);
                  setIsEditing(false);
                }}
                type="button"
              >
                Cancel
              </button>
            </div>
            {state.message ? <span className={`form-message ${state.status}`}>{state.message}</span> : null}
          </div>
        </form>
      ) : (
        <>
          <div className="source-query-body">
            <p className="source-query source-query-surface">{displayedQuery}</p>
          </div>
          {copyState !== "idle" ? (
            <span className={`form-message ${copyState === "error" ? "error" : "success"}`}>
              {copyState === "copied" ? "Copied" : "Copy failed"}
            </span>
          ) : null}
        </>
      )}
    </section>
  );
}
