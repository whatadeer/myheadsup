"use client";

import { useState } from "react";
import { describeRequestError } from "@/lib/request-errors";
import type { RuntimeConfig } from "@/lib/types";

type ScheduleRunButtonProps = {
  onTriggered?: () => void;
  projectId: number;
  runtimeConfig?: RuntimeConfig | null;
  scheduleId: number;
};

export function ScheduleRunButton({
  onTriggered,
  projectId,
  runtimeConfig,
  scheduleId,
}: ScheduleRunButtonProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");

  async function handleClick() {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setMessage("");
    setStatus("idle");

    try {
      const response = await fetch("/api/gitlab/schedules/play", {
        body: JSON.stringify({
          projectId,
          runtimeConfig,
          scheduleId,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json()) as { message?: string };

      if (!response.ok) {
        throw new Error(payload.message || "Unable to trigger the pipeline schedule.");
      }

      setStatus("success");
      setMessage(payload.message || "Pipeline schedule triggered.");
      onTriggered?.();
    } catch (error) {
      setStatus("error");
      setMessage(
        describeRequestError(error, "Unable to trigger the pipeline schedule right now."),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="schedule-run-shell">
      <button
        className="subtle-action-button"
        disabled={isSubmitting}
        onClick={handleClick}
        type="button"
      >
        {isSubmitting ? "Running..." : "Run now"}
      </button>
      {message ? <span className={`form-message ${status}`}>{message}</span> : null}
    </div>
  );
}
