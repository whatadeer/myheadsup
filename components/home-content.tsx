"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { addSourceAction, removeSourceAction, updateGroupDefinitionAction } from "@/app/actions";
import { DashboardRefreshStatus } from "@/components/dashboard-refresh-status";
import { GroupTreeFilter } from "@/components/group-tree-filter";
import { JiraProjectLinks } from "@/components/jira-project-links";
import { LoadingStatus } from "@/components/loading-status";
import { ProjectDetailTabs } from "@/components/project-detail-tabs";
import { RuntimeConfigSetup } from "@/components/runtime-config-setup";
import { SourceForm } from "@/components/source-form";
import { formatProjectLanguages } from "@/lib/project-languages";
import { reconcileDashboardsWithSavedSources } from "@/lib/source-dashboard";
import { sanitizeRuntimeConfig } from "@/lib/runtime-config";
import { describeRequestError } from "@/lib/request-errors";
import { labelPipeline, statusTone } from "@/lib/pipeline";
import type {
  ActionState,
  DashboardResponsePayload,
  DashboardSnapshotSummary,
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

type HomeContentProps = {
  initialDashboards: SourceDashboard[];
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
  initialDashboards,
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
  const [loadedDashboards, setLoadedDashboards] = useState<SourceDashboard[]>(initialDashboards);
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
  const [refreshStatusText, setRefreshStatusText] = useState(
    savedSources.length
      ? "Automatic refresh is off. Turn it on when you want scheduled updates."
      : "Add a saved source to enable automatic refresh.",
  );
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
    async (trigger: "auto" | "followup" | "initial" | "manual") => {
      if (!canRefreshDashboards || refreshAbortControllerRef.current) {
        return;
      }

      const controller = new AbortController();
      refreshAbortControllerRef.current = controller;

      setRuntimeDashboardLoading(true);
      setRuntimeDashboardError("");
      setRefreshStatusText(
        trigger === "manual"
          ? "Refreshing the dashboard now."
          : trigger === "followup"
            ? "Checking for the latest background refresh."
          : trigger === "initial"
            ? "Loading the dashboard with live GitLab data."
            : "Running the scheduled refresh.",
      );
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
              setRefreshStatusText(
                `${message} Retrying in ${formatCountdown(retryDelay)} (${attempt + 1}/${maxAttempts}).`,
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
          setRefreshStatusText(message);
          return;
        }

        setRuntimeDashboardError("");
        setRefreshStatusText(buildDashboardRefreshMessage(trigger, resolvedSnapshotSummary));
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
        setRefreshStatusText(message);
      } finally {
        if (refreshAbortControllerRef.current === controller) {
          refreshAbortControllerRef.current = null;
        }

        if (!controller.signal.aborted) {
          setRuntimeDashboardLoading(false);
        }
      }
    },
    [autoRefreshEnabled, canRefreshDashboards, hasVisibleDashboardData, runtimeConfig],
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
    setRefreshStatusText(
      autoRefreshEnabled
        ? "Browser settings saved. Live refresh is ready."
        : "Browser settings saved. Use Refresh now or enable automatic refresh.",
    );
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
    setNextRefreshAt(0);
    setRefreshStatusText("Save browser settings to enable live refresh.");
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
    setRefreshStatusText(
      nextValue
        ? `Automatic refresh enabled. Refresh runs every ${formatRefreshInterval(autoRefreshIntervalMs)}.`
        : "Automatic refresh disabled. Use Refresh now whenever you want to update the dashboard.",
    );
  }

  const handleScheduleTriggered = useCallback(() => {
    if (!canRefreshDashboards) {
      return;
    }

    void loadDashboards(hasVisibleDashboardData ? "manual" : "initial");
  }, [canRefreshDashboards, hasVisibleDashboardData, loadDashboards]);

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
          statusText={refreshStatusText}
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

function formatRefreshInterval(valueMs: number) {
  const totalSeconds = Math.max(1, Math.round(valueMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (!minutes) {
    return `${seconds} seconds`;
  }

  if (!seconds) {
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
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

function buildDashboardRefreshMessage(
  trigger: "auto" | "followup" | "initial" | "manual",
  snapshotSummary: DashboardSnapshotSummary,
) {
  if (snapshotSummary.status === "refreshing") {
    if (snapshotSummary.lastUpdatedAt) {
      return `Showing the last saved snapshot from ${formatSnapshotTimestamp(snapshotSummary.lastUpdatedAt)} while a background refresh runs.`;
    }

    return "Refreshing the dashboard in the background.";
  }

  if (snapshotSummary.status === "stale") {
    if (snapshotSummary.lastUpdatedAt) {
      return `Showing the last saved snapshot from ${formatSnapshotTimestamp(snapshotSummary.lastUpdatedAt)}.`;
    }

    return "Showing the last saved snapshot.";
  }

  if (trigger === "manual") {
    return "Dashboard refreshed manually.";
  }

  if (trigger === "followup") {
    return "Background refresh complete.";
  }

  if (trigger === "initial") {
    return "Live dashboard loaded.";
  }

  return "Automatic refresh complete.";
}

function formatSnapshotTimestamp(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "the latest successful refresh";
  }

  return parsed.toLocaleString();
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
  onScheduleTriggered,
  runtimeConfig,
}: {
  dashboard: SourceDashboard;
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
        onScheduleTriggered={onScheduleTriggered}
        runtimeConfig={runtimeConfig}
      />
    );
  }

  return (
    <GroupSourceCard
      dashboard={dashboard}
      onScheduleTriggered={onScheduleTriggered}
      runtimeConfig={runtimeConfig}
    />
  );
}

function ProjectSourceCard({
  dashboard,
  onScheduleTriggered,
  runtimeConfig,
}: {
  dashboard: Extract<SourceDashboard, { kind: "project" }>;
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
  onScheduleTriggered,
  runtimeConfig,
}: {
  dashboard: Extract<SourceDashboard, { kind: "group" }>;
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
  const [isEditing, setIsEditing] = useState(false);
  const [draftQuery, setDraftQuery] = useState(query);
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
      await navigator.clipboard.writeText(query);
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
            <button className="subtle-action-button" onClick={handleCopy} type="button">
              <span aria-hidden="true">Copy</span>
              <span className="sr-only"> group definition</span>
            </button>
            {editable && sourceId ? (
              <button
                className="subtle-action-button"
                onClick={() => {
                  setDraftQuery(query);
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
                  setDraftQuery(query);
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
            <p className="source-query source-query-surface">{query}</p>
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
