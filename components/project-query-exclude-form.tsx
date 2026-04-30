"use client";

import { useActionState } from "react";
import { excludeProjectFromSourceAction } from "@/app/actions";
import type { ActionState } from "@/lib/types";

const initialState: ActionState = {
  status: "idle",
  message: "",
};

type ProjectQueryExcludeFormProps = {
  projectId: number;
  projectName: string;
  projectReference: string;
  projectWebUrl: string;
  sourceId: string;
};

export function ProjectQueryExcludeForm({
  projectId,
  projectName,
  projectReference,
  projectWebUrl,
  sourceId,
}: ProjectQueryExcludeFormProps) {
  const [state, formAction, pending] = useActionState(
    excludeProjectFromSourceAction,
    initialState,
  );

  return (
    <form action={formAction} className="inline-action-form">
      <input name="projectId" type="hidden" value={projectId} />
      <input name="projectName" type="hidden" value={projectName} />
      <input name="projectReference" type="hidden" value={projectReference} />
      <input name="projectWebUrl" type="hidden" value={projectWebUrl} />
      <input name="sourceId" type="hidden" value={sourceId} />
      <button className="subtle-action-button" disabled={pending} type="submit">
        {pending ? "Excluding..." : "Exclude from query"}
      </button>
      {state.message ? <span className={`form-message ${state.status}`}>{state.message}</span> : null}
    </form>
  );
}
