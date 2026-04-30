"use client";

import { useEffect, useState } from "react";
import { describeRequestError } from "@/lib/request-errors";
import type { RuntimeConfig, SourceSuggestion } from "@/lib/types";

export function useReferenceSuggestions(query: string, runtimeConfig?: RuntimeConfig | null) {
  const [options, setOptions] = useState<SourceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setLoading(true);
      setErrorMessage("");

      try {
        const response = await fetch("/api/gitlab/references", {
          body: JSON.stringify({
            q: query.trim(),
            runtimeConfig,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
          signal: controller.signal,
        });
        const payload = (await response.json()) as {
          message?: string;
          suggestions?: SourceSuggestion[];
        };

        if (!response.ok) {
          throw new Error(payload.message || "Unable to load GitLab suggestions.");
        }

        setOptions(payload.suggestions ?? []);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setOptions([]);
        setErrorMessage(
          describeRequestError(
            error,
            "Unable to reach GitLab right now. Check the saved URL and token, then try again.",
          ),
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, query.trim() ? 250 : 0);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [query, runtimeConfig]);

  return { errorMessage, loading, options };
}
