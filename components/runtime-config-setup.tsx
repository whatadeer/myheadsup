"use client";

import { useState } from "react";
import {
  emptyRuntimeConfig,
  getRuntimeConfigValidationErrorWithOptions,
  sanitizeRuntimeConfig,
} from "@/lib/runtime-config";
import type { RuntimeConfig } from "@/lib/types";

type RuntimeConfigSetupProps = {
  currentValue: RuntimeConfig | null;
  onClear: () => void;
  onSave: (nextValue: RuntimeConfig) => void;
  requireGitLab: boolean;
  serverConfigError: string | null;
};

export function RuntimeConfigSetup({
  currentValue,
  onClear,
  onSave,
  requireGitLab,
  serverConfigError,
}: RuntimeConfigSetupProps) {
  const [formState, setFormState] = useState<RuntimeConfig>(currentValue ?? emptyRuntimeConfig());
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  function updateField<Key extends keyof RuntimeConfig>(key: Key, value: RuntimeConfig[Key]) {
    setFormState((currentValue) => ({
      ...currentValue,
      [key]: value,
    }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextValue = sanitizeRuntimeConfig(formState);
    const validationError = getRuntimeConfigValidationErrorWithOptions(nextValue, {
      requireGitLab,
    });

    if (validationError) {
      setStatus("error");
      setMessage(validationError);
      return;
    }

    onSave(nextValue);
    setFormState(nextValue);
    setStatus("success");
    setMessage("Saved browser settings for this device.");
  }

  return (
    <div className="runtime-config-shell">
      <div className="notice setup-prompt">
        {requireGitLab ? (
          <>
            <p>
              Server environment variables are missing, so live GitLab data is blocked until
              you configure this browser. Stored browser settings stay local to this browser
              and are not written into the container.
            </p>
            <p className="helper-text">Current setup block: {serverConfigError}</p>
          </>
        ) : (
          <p>
            Optional browser settings stay local to this browser and can add Jira links or
            override GitLab and SonarQube settings without changing the server environment.
          </p>
        )}
      </div>

      <form className="runtime-config-form" onSubmit={handleSubmit}>
        <div className="runtime-config-grid">
          <div className="field">
            <label htmlFor="runtime-gitlab-base-url">GitLab base URL</label>
            <input
              className="input"
              id="runtime-gitlab-base-url"
              onChange={(event) => updateField("gitlabBaseUrl", event.target.value)}
              placeholder="https://gitlab.example.com"
              type="url"
              value={formState.gitlabBaseUrl}
            />
          </div>
          <div className="field">
            <label htmlFor="runtime-gitlab-token">GitLab token</label>
            <input
              className="input"
              id="runtime-gitlab-token"
              onChange={(event) => updateField("gitlabToken", event.target.value)}
              placeholder="Personal access token with read_api"
              type="password"
              value={formState.gitlabToken}
            />
          </div>
          <div className="field">
            <label htmlFor="runtime-jira-base-url">Jira base URL</label>
            <input
              className="input"
              id="runtime-jira-base-url"
              onChange={(event) => updateField("jiraBaseUrl", event.target.value)}
              placeholder="Optional"
              type="url"
              value={formState.jiraBaseUrl}
            />
          </div>
          <div className="field">
            <label htmlFor="runtime-sonar-base-url">SonarQube base URL</label>
            <input
              className="input"
              id="runtime-sonar-base-url"
              onChange={(event) => updateField("sonarQubeBaseUrl", event.target.value)}
              placeholder="Optional"
              type="url"
              value={formState.sonarQubeBaseUrl}
            />
          </div>
          <div className="field">
            <label htmlFor="runtime-sonar-token">SonarQube token</label>
            <input
              className="input"
              id="runtime-sonar-token"
              onChange={(event) => updateField("sonarQubeToken", event.target.value)}
              placeholder="Optional"
              type="password"
              value={formState.sonarQubeToken}
            />
          </div>
        </div>

        <div className="runtime-config-actions">
          <button className="button" type="submit">
            Save browser settings
          </button>
          {currentValue ? (
            <button
              className="text-button"
              onClick={() => {
                onClear();
                setStatus("idle");
                setMessage("");
              }}
              type="button"
            >
              Clear browser settings
            </button>
          ) : null}
        </div>

        <p className="field-note">
          Use server environment variables when possible. Browser-stored tokens are less
          secure because they remain accessible to this browser profile.
        </p>
        <p className={`form-message ${status}`}>
          {message ||
            (requireGitLab
              ? "GitLab settings are required. Jira and SonarQube are optional."
              : "Jira is optional. Enter GitLab or SonarQube values only when you want browser-only overrides.")}
        </p>
      </form>
    </div>
  );
}
