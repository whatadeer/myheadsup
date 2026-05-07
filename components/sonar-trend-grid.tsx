import type { SonarMetricHistoryPoint, SonarProjectSummary } from "@/lib/types";

type SonarTrendGridProps = {
  sonar: SonarProjectSummary;
};

export function SonarTrendGrid({ sonar }: SonarTrendGridProps) {
  const hasTrendData =
    sonar.coverageHistory.length > 1 ||
    sonar.bugHistory.length > 1 ||
    sonar.codeSmellHistory.length > 1;

  if (!hasTrendData) {
    return null;
  }

  return (
    <div className="sonar-trend-grid">
      <SonarTrendCard
        currentValue={sonar.coverage}
        detailFormatter={formatCoverageDelta}
        label="Coverage"
        points={sonar.coverageHistory}
        valueFormatter={formatCoverageValue}
      />
      <SonarTrendCard currentValue={sonar.bugs} label="Bugs" points={sonar.bugHistory} />
      <SonarTrendCard
        currentValue={sonar.codeSmells}
        detailFormatter={formatCountDelta}
        label="Code smells"
        points={sonar.codeSmellHistory}
        valueFormatter={formatCountValue}
      />
    </div>
  );
}

function SonarTrendCard({
  currentValue,
  detailFormatter = formatCountDelta,
  label,
  points,
  valueFormatter = formatCountValue,
}: {
  currentValue: number | null;
  detailFormatter?: (delta: number) => string;
  label: string;
  points: SonarMetricHistoryPoint[];
  valueFormatter?: (value: number) => string;
}) {
  const latestPoint = points[points.length - 1];
  const earliestPoint = points[0];

  if (!latestPoint || !earliestPoint) {
    return null;
  }

  const delta = latestPoint.value - earliestPoint.value;

  return (
    <div className="sonar-trend-card">
      <div className="sonar-trend-header">
        <span className="sonar-trend-label">{label}</span>
        <span className="sonar-trend-value">{valueFormatter(currentValue ?? latestPoint.value)}</span>
      </div>
      <Sparkline points={points} />
      <span className="sonar-trend-detail">{detailFormatter(delta)}</span>
    </div>
  );
}

function formatCountValue(value: number) {
  return String(value);
}

function formatCoverageValue(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatCountDelta(delta: number) {
  return delta === 0 ? "Flat" : `${delta > 0 ? "+" : ""}${delta} over recent analyses`;
}

function formatCoverageDelta(delta: number) {
  return delta === 0
    ? "Flat"
    : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} pts over recent analyses`;
}

function Sparkline({ points }: { points: SonarMetricHistoryPoint[] }) {
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 120;
  const height = 38;

  const polyline = points
    .map((point, index) => {
      const x = points.length === 1 ? width / 2 : (index / (points.length - 1)) * width;
      const y = height - ((point.value - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      aria-hidden="true"
      className="sonar-trend-sparkline"
      viewBox={`0 0 ${width} ${height}`}
    >
      <polyline
        className="sonar-trend-line"
        fill="none"
        points={polyline}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
