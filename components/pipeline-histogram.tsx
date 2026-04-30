import type { PipelineHistogramBucket } from "@/lib/types";

type PipelineHistogramProps = {
  buckets: PipelineHistogramBucket[];
  label: string;
  compact?: boolean;
  onSelectDate?: (date: string) => void;
  onClearSelection?: () => void;
  selectedDate?: string | null;
};

export function PipelineHistogram({
  buckets,
  label,
  compact = false,
  onSelectDate,
  onClearSelection,
  selectedDate = null,
}: PipelineHistogramProps) {
  const maxCount = Math.max(...buckets.map((bucket) => bucket.count), 0);
  const isInteractive = Boolean(onSelectDate);

  return (
    <div className={`summary-stack${compact ? " histogram-stack-compact" : ""}`}>
      <div className="section-heading-row">
        <h3 className="section-heading">{label}</h3>
        {selectedDate && onClearSelection ? (
          <button className="text-button" onClick={onClearSelection} type="button">
            Clear day filter
          </button>
        ) : null}
      </div>
      {!compact ? (
        <div className="histogram-legend" aria-hidden="true">
          <span className="histogram-legend-item">
            <span className="histogram-legend-swatch histogram-bar-active" />
            Success
          </span>
          <span className="histogram-legend-item">
            <span className="histogram-legend-swatch histogram-bar-failed" />
            Failed
          </span>
          <span className="histogram-legend-item">
            <span className="histogram-legend-swatch histogram-bar-other" />
            Other
          </span>
        </div>
      ) : null}
      <div
        aria-label={label}
        className={`histogram${compact ? " histogram-compact" : ""}${selectedDate ? " histogram-has-selection" : ""}`}
        role={isInteractive ? undefined : "img"}
      >
        {buckets.map((bucket) => {
          const height = maxCount === 0 ? 12 : Math.max((bucket.count / maxCount) * 100, 12);
          const successPercent = bucket.count
            ? (bucket.successCount / bucket.count) * 100
            : 0;
          const failedPercent = bucket.count ? (bucket.failedCount / bucket.count) * 100 : 0;
          const otherPercent = Math.max(100 - successPercent - failedPercent, 0);
          const selectionClass =
            selectedDate === bucket.date
              ? " histogram-column-selected"
              : selectedDate
                ? " histogram-column-dimmed"
                : "";
          const title = formatHistogramTitle(bucket);

          return (
            <div className={`histogram-column${selectionClass}`} key={bucket.date}>
              {onSelectDate ? (
                <button
                  aria-label={title}
                  className="histogram-bar-button"
                  onClick={() => onSelectDate(bucket.date)}
                  type="button"
                >
                  <span className="histogram-bar" style={{ height: `${height}%` }} title={title}>
                    {otherPercent > 0 ? (
                      <span
                        className="histogram-segment histogram-bar-other"
                        style={{ height: `${otherPercent}%` }}
                      />
                    ) : null}
                    {successPercent > 0 ? (
                      <span
                        className="histogram-segment histogram-bar-active"
                        style={{ height: `${successPercent}%` }}
                      />
                    ) : null}
                    {failedPercent > 0 ? (
                      <span
                        className="histogram-segment histogram-bar-failed"
                        style={{ height: `${failedPercent}%` }}
                      />
                    ) : null}
                  </span>
                </button>
              ) : (
                <span className="histogram-bar" style={{ height: `${height}%` }} title={title}>
                  {otherPercent > 0 ? (
                    <span
                      className="histogram-segment histogram-bar-other"
                      style={{ height: `${otherPercent}%` }}
                    />
                  ) : null}
                  {successPercent > 0 ? (
                    <span
                      className="histogram-segment histogram-bar-active"
                      style={{ height: `${successPercent}%` }}
                    />
                  ) : null}
                  {failedPercent > 0 ? (
                    <span
                      className="histogram-segment histogram-bar-failed"
                      style={{ height: `${failedPercent}%` }}
                    />
                  ) : null}
                </span>
              )}
              <span className="histogram-value">{bucket.count}</span>
              <span className="histogram-label">{formatHistogramTick(bucket.date)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatHistogramLabel(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(new Date(value));
}

function formatHistogramTick(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatHistogramTitle(bucket: PipelineHistogramBucket) {
  const dateLabel = formatHistogramLabel(bucket.date);
  const parts = [`${bucket.count} runs on ${dateLabel}`];

  if (bucket.successCount > 0) {
    parts.push(`${bucket.successCount} successful`);
  }

  if (bucket.failedCount > 0) {
    parts.push(`${bucket.failedCount} failed`);
  }

  const otherCount = bucket.count - bucket.successCount - bucket.failedCount;

  if (otherCount > 0) {
    parts.push(`${otherCount} other`);
  }

  return parts.join(", ");
}
