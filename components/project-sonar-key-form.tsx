"use client";

import { useActionState } from "react";
import { updateProjectSonarKeyAction } from "@/app/actions";
import type { ActionState } from "@/lib/types";

const initialState: ActionState = {
  status: "idle",
  message: "",
};

type ProjectSonarKeyFormProps = {
  currentKey: string | null;
  embedded?: boolean;
  projectId: number;
  projectReference: string;
  sourceId: string;
};

export function ProjectSonarKeyForm({
  currentKey,
  embedded = false,
  projectId,
  projectReference,
  sourceId,
}: ProjectSonarKeyFormProps) {
  const [state, formAction, pending] = useActionState(
    updateProjectSonarKeyAction,
    initialState,
  );
  const fieldId = `${sourceId}-${projectId}-sonarProjectKey`;
  const hasSavedKey = Boolean(currentKey?.trim());

  const form = (
    <form action={formAction} className="sonar-key-form">
      <input name="projectId" type="hidden" value={projectId} />
      <input name="projectReference" type="hidden" value={projectReference} />
      <input name="sourceId" type="hidden" value={sourceId} />
      <label className="sonar-key-label" htmlFor={fieldId}>
        SonarQube project key
      </label>
      <div className="sonar-key-controls">
        <input
          className="input"
          defaultValue={currentKey ?? ""}
          id={fieldId}
          name="sonarProjectKey"
          placeholder="Set or clear this project's SonarQube key"
          type="text"
        />
        <button className="button sonar-key-button" disabled={pending} type="submit">
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
      <span className={`form-message ${state.status}`}>
        {state.message || "Leave blank to remove the saved SonarQube key."}
      </span>
    </form>
  );

  if (embedded) {
    return form;
  }

  return (
    <details className={`sonar-key-shell${hasSavedKey ? " subtle" : ""}`}>
      {hasSavedKey ? (
        <summary className="sonar-key-summary">
          <span className="sonar-key-summary-label">SonarQube key set</span>
          <span className="sonar-key-summary-value">{currentKey}</span>
        </summary>
      ) : null}
      {form}
    </details>
  );
}
