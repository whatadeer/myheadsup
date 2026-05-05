"use client";

import { useActionState } from "react";
import { excludeGroupFromSourceAction } from "@/app/actions";
import type { ActionState } from "@/lib/types";

const initialState: ActionState = {
  status: "idle",
  message: "",
};

type GroupQueryExcludeFormProps = {
  groupId: number;
  groupName: string;
  groupReference: string;
  groupWebUrl: string;
  sourceId: string;
};

export function GroupQueryExcludeForm({
  groupId,
  groupName,
  groupReference,
  groupWebUrl,
  sourceId,
}: GroupQueryExcludeFormProps) {
  const [state, formAction, pending] = useActionState(
    excludeGroupFromSourceAction,
    initialState,
  );

  return (
    <form
      action={formAction}
      className="inline-action-form"
      onClickCapture={(event) => event.stopPropagation()}
      onKeyDownCapture={(event) => event.stopPropagation()}
    >
      <input name="groupId" type="hidden" value={groupId} />
      <input name="groupName" type="hidden" value={groupName} />
      <input name="groupReference" type="hidden" value={groupReference} />
      <input name="groupWebUrl" type="hidden" value={groupWebUrl} />
      <input name="sourceId" type="hidden" value={sourceId} />
      <button className="subtle-action-button" disabled={pending} type="submit">
        {pending ? "Excluding..." : "Exclude group from query"}
      </button>
      {state.message ? <span className={`form-message ${state.status}`}>{state.message}</span> : null}
    </form>
  );
}
