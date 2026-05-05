"use client";

import { useActionState } from "react";
import { updateProjectJiraKeysAction } from "@/app/actions";
import { JiraProjectLinks } from "@/components/jira-project-links";
import type { ActionState } from "@/lib/types";

const initialState: ActionState = {
  status: "idle",
  message: "",
};

type ProjectJiraKeyFormProps = {
  currentKeys: string[];
  embedded?: boolean;
  jiraBaseUrl: string | null;
  projectId: number;
  projectReference: string;
  sourceId: string;
};

export function ProjectJiraKeyForm({
  currentKeys,
  embedded = false,
  jiraBaseUrl,
  projectId,
  projectReference,
  sourceId,
}: ProjectJiraKeyFormProps) {
  const [state, formAction, pending] = useActionState(
    updateProjectJiraKeysAction,
    initialState,
  );
  const fieldId = `${sourceId}-${projectId}-jiraProjectKeys`;
  const hasSavedKeys = currentKeys.length > 0;

  const form = (
    <form action={formAction} className="sonar-key-form">
      <input name="projectId" type="hidden" value={projectId} />
      <input name="projectReference" type="hidden" value={projectReference} />
      <input name="sourceId" type="hidden" value={sourceId} />
      <label className="sonar-key-label" htmlFor={fieldId}>
        Jira project keys
      </label>
      <div className="sonar-key-controls">
        <input
          className="input"
          defaultValue={currentKeys.join(", ")}
          id={fieldId}
          name="jiraProjectKeys"
          placeholder="ABC, XYZ"
          type="text"
        />
        <button className="button sonar-key-button" disabled={pending} type="submit">
          {pending ? "Saving..." : "Save"}
        </button>
      </div>
      <JiraProjectLinks baseUrl={jiraBaseUrl} jiraProjectKeys={currentKeys} />
      <span className={`form-message ${state.status}`}>
        {state.message || "Use commas to save one or more Jira project keys. Leave blank to remove them."}
      </span>
    </form>
  );

  if (embedded) {
    return form;
  }

  return (
    <details className={`sonar-key-shell${hasSavedKeys ? " subtle" : ""}`}>
      {hasSavedKeys ? (
        <summary className="sonar-key-summary">
          <span className="sonar-key-summary-label">Jira keys set</span>
          <span className="sonar-key-summary-value">{currentKeys.join(", ")}</span>
        </summary>
      ) : null}
      {form}
    </details>
  );
}
