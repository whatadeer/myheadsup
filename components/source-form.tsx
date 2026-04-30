"use client";

import { useActionState, useMemo, useState } from "react";
import { ReferenceCombobox } from "@/components/reference-combobox";
import { ReferenceMultiselect } from "@/components/reference-multiselect";
import { buildSourceQuery, sameSourceReference } from "@/lib/source-query";
import type { ActionState, RuntimeConfig, SourceKind, SourceSuggestion } from "@/lib/types";

const initialState: ActionState = {
  status: "idle",
  message: "",
};

type SourceFormProps = {
  action: (
    state: ActionState,
    payload: FormData,
  ) => Promise<ActionState>;
  runtimeConfig?: RuntimeConfig | null;
};

export function SourceForm({ action, runtimeConfig }: SourceFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [reference, setReference] = useState("");
  const [selectedKind, setSelectedKind] = useState<SourceKind | "source">("source");
  const [selectedSource, setSelectedSource] = useState<SourceSuggestion | null>(null);
  const [excludedSources, setExcludedSources] = useState<SourceSuggestion[]>([]);
  const [sonarProjectKey, setSonarProjectKey] = useState("");
  const [manualSourceQuery, setManualSourceQuery] = useState("");

  const builtSourceQuery = useMemo(
    () =>
      buildSourceQuery(
        selectedKind,
        reference,
        excludedSources,
        selectedKind === "group" ? null : sonarProjectKey,
      ),
    [excludedSources, reference, selectedKind, sonarProjectKey],
  );
  const sourceQuery = manualSourceQuery || builtSourceQuery;

  return (
    <form action={formAction} className="source-form">
      <div className="source-form-grid">
        <div className="field source-query-field">
          <label htmlFor="sourceQueryDefinition">Saved source query</label>
          <textarea
            className="input source-query-preview"
            id="sourceQueryDefinition"
            name="sourceQueryDefinition"
            onChange={(event) => setManualSourceQuery(event.target.value)}
            placeholder="Add Source platform/team"
            rows={Math.max(sourceQuery.split("\n").length || 1, 2)}
            spellCheck={false}
            required
            value={sourceQuery}
          />
          <span className="field-note">
            Paste an existing saved source query here to add it directly, or use the pickers below to build one.
          </span>
        </div>
        <ReferenceCombobox
          id="reference"
          label="Group or project"
          name="reference"
          onChange={(nextReference, nextSuggestion) => {
            setManualSourceQuery("");
            setReference(nextReference);
            setSelectedSource(nextSuggestion);
            setSelectedKind(nextSuggestion?.kind ?? "source");
            setExcludedSources((currentSources) =>
              nextSuggestion
                ? currentSources.filter(
                    (source) => !sameSourceReference(source, nextSuggestion),
                  )
                : currentSources,
            );

            if (nextSuggestion?.kind === "project") {
              setExcludedSources([]);
            }

            if (nextSuggestion?.kind === "group") {
              setSonarProjectKey("");
            }
          }}
          placeholder="platform/backend, platform/team, or 1234"
          required={false}
          runtimeConfig={runtimeConfig}
        />
        <ReferenceMultiselect
          blockedSources={selectedSource ? [selectedSource] : []}
          disabled={selectedKind === "project"}
          id="excludedSourcesPicker"
          label="Exclude groups or projects"
          onChange={(nextSources) => {
            setManualSourceQuery("");
            setExcludedSources(nextSources);
          }}
          placeholder="Search accessible groups and projects to exclude"
          runtimeConfig={runtimeConfig}
          selected={excludedSources}
        />
        <div className="field">
          <label htmlFor="sonarProjectKey">SonarQube project key</label>
          <input
            className="input"
            id="sonarProjectKey"
            name="sonarProjectKey"
            onChange={(event) => {
              setManualSourceQuery("");
              setSonarProjectKey(event.target.value);
            }}
            placeholder="Optional manual SonarQube key"
            type="text"
            value={sonarProjectKey}
          />
          <span className="field-note">
            Applied only when the saved source resolves to a project. Group project keys are edited inside the group view.
          </span>
        </div>
        <input
          name="excludedSources"
          type="hidden"
          value={JSON.stringify(
            excludedSources.map((source) => ({
              gitlabId: source.gitlabId,
              kind: source.kind,
            })),
          )}
        />
        <input
          name="selectedKind"
          type="hidden"
          value={selectedKind === "source" ? "" : selectedKind}
        />
        <input
          name="runtimeConfig"
          type="hidden"
          value={runtimeConfig ? JSON.stringify(runtimeConfig) : ""}
        />

        <button className="button" disabled={pending} type="submit">
          {pending ? "Adding..." : "Add source"}
        </button>
      </div>

      <p className={`form-message ${state.status}`}>
        {state.message ||
          "Build or paste a saved source query from accessible GitLab groups and projects, then optionally add a SonarQube key for a saved project."}
      </p>
    </form>
  );
}
