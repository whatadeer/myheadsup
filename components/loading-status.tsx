"use client";

import { useEffect, useMemo, useState } from "react";

type LoadingStatusProps = {
  description: string;
  stages: string[];
  title: string;
};

const loadingStartProgress = 12;
const loadingMaxProgress = 92;

export function LoadingStatus({
  description,
  stages,
  title,
}: LoadingStatusProps) {
  const [progress, setProgress] = useState(loadingStartProgress);

  useEffect(() => {
    const startedAt = window.performance.now();
    const intervalId = window.setInterval(() => {
      const elapsedMs = window.performance.now() - startedAt;
      const nextProgress =
        loadingStartProgress +
        (loadingMaxProgress - loadingStartProgress) *
          (1 - Math.exp(-elapsedMs / 3200));

      setProgress(Math.min(nextProgress, loadingMaxProgress));
    }, 120);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const currentStage = useMemo(() => {
    if (!stages.length) {
      return "Loading...";
    }

    const stageIndex = Math.min(
      stages.length - 1,
      Math.floor((progress / 100) * stages.length),
    );

    return stages[stageIndex];
  }, [progress, stages]);

  return (
    <div aria-live="polite" className="loading-status" role="status">
      <div className="loading-status-header">
        <h2>{title}</h2>
        <span className="status-pill status-running">{Math.round(progress)}%</span>
      </div>
      <p>{description}</p>
      <div
        aria-label={`${title} progress`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={Math.round(progress)}
        className="loading-progress"
        role="progressbar"
      >
        <div
          className="loading-progress-bar"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="helper-text">{currentStage}</p>
    </div>
  );
}
