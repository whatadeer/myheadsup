"use client";

type DashboardRefreshStatusProps = {
  autoRefreshEnabled: boolean;
  isLoading: boolean;
  manualCooldownRemainingMs: number;
  onRefresh: () => void;
  onToggleAutoRefresh: () => void;
  statusText: string;
};

export function DashboardRefreshStatus({
  autoRefreshEnabled,
  isLoading,
  manualCooldownRemainingMs,
  onRefresh,
  onToggleAutoRefresh,
  statusText,
}: DashboardRefreshStatusProps) {
  const manualRefreshDisabled = isLoading || manualCooldownRemainingMs > 0;
  const refreshLabel = isLoading
    ? "Refreshing..."
    : manualCooldownRemainingMs > 0
      ? `Refresh in ${formatDuration(manualCooldownRemainingMs)}`
      : "Refresh now";

  return (
    <aside aria-live="polite" className="refresh-dock" role="status">
      <span className="sr-only">{statusText}</span>
      <div className="refresh-dock-row">
        <button
          aria-pressed={autoRefreshEnabled}
          className={`refresh-dock-button refresh-dock-button-secondary${autoRefreshEnabled ? " active" : ""}`}
          onClick={onToggleAutoRefresh}
          type="button"
        >
          {autoRefreshEnabled ? "Auto refresh" : "Auto refresh off"}
        </button>
        <button
          className="refresh-dock-button"
          disabled={manualRefreshDisabled}
          onClick={onRefresh}
          type="button"
        >
          {refreshLabel}
        </button>
      </div>
    </aside>
  );
}

function formatDuration(valueMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(valueMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 1) {
    return `${seconds}s`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
