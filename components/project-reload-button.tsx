"use client";

import { useState } from "react";
import type { ActionState } from "@/lib/types";

type ProjectReloadButtonProps = {
  label?: string;
  onReload: () => Promise<ActionState>;
};

export function ProjectReloadButton({
  label = "Reload project",
  onReload,
}: ProjectReloadButtonProps) {
  const [pending, setPending] = useState(false);
  const [state, setState] = useState<ActionState>({
    status: "idle",
    message: "",
  });

  async function handleClick() {
    if (pending) {
      return;
    }

    setPending(true);
    setState({ status: "idle", message: "" });

    try {
      setState(await onReload());
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="project-reload-shell">
      <button className="subtle-action-button" disabled={pending} onClick={handleClick} type="button">
        {pending ? "Reloading..." : label}
      </button>
      {state.message ? <span className={`form-message ${state.status}`}>{state.message}</span> : null}
    </div>
  );
}
