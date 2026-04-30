"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from "@headlessui/react";
import { sameSourceReference } from "@/lib/source-query";
import type { RuntimeConfig, SourceSuggestion } from "@/lib/types";
import { useReferenceSuggestions } from "@/components/use-reference-suggestions";

type ReferenceMultiselectProps = {
  blockedSources?: SourceSuggestion[];
  disabled?: boolean;
  id: string;
  label: string;
  onChange: (value: SourceSuggestion[]) => void;
  placeholder: string;
  runtimeConfig?: RuntimeConfig | null;
  selected: SourceSuggestion[];
};

export function ReferenceMultiselect({
  blockedSources = [],
  disabled = false,
  id,
  label,
  onChange,
  placeholder,
  runtimeConfig,
  selected,
}: ReferenceMultiselectProps) {
  const [query, setQuery] = useState("");
  const { errorMessage, loading, options } = useReferenceSuggestions(query, runtimeConfig);

  const visibleOptions = useMemo(
    () =>
      options.filter(
        (option) =>
          !selected.some((entry) => sameSourceReference(entry, option)) &&
          !blockedSources.some((entry) => sameSourceReference(entry, option)),
      ),
    [blockedSources, options, selected],
  );

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>

      <Combobox
        immediate
        onChange={(nextValue: SourceSuggestion | null) => {
          if (!nextValue) {
            return;
          }

          onChange([...selected, nextValue]);
          setQuery("");
        }}
        value={null}
      >
        <div className="combobox">
          <div className="combobox-control">
            <ComboboxInput
              autoComplete="off"
              className="input combobox-input"
              displayValue={() => query}
              disabled={disabled}
              id={id}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
            />

            <ComboboxButton
              aria-label="Show matching groups and projects to exclude"
              className="combobox-button"
              disabled={disabled}
              type="button"
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="16"
                viewBox="0 0 16 16"
                width="16"
              >
                <path
                  d="M4 6.5L8 10.5L12 6.5"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                />
              </svg>
            </ComboboxButton>
          </div>

          {!disabled ? (
            <ComboboxOptions className="combobox-options" portal={false}>
              {visibleOptions.length ? (
                visibleOptions.map((option) => (
                  <ComboboxOption
                    className={({ focus, selected: isSelected }) =>
                      `combobox-option combobox-option-${option.kind}${focus ? " active" : ""}${isSelected ? " selected" : ""}`
                    }
                    key={`${option.kind}-${option.gitlabId}`}
                    style={
                      {
                        "--combobox-depth": getSuggestionDepth(option),
                        "--combobox-connector-opacity": getSuggestionDepth(option) > 0 ? 1 : 0,
                      } as CSSProperties
                    }
                    value={option}
                  >
                    <div className="combobox-option-copy">
                      <div className="combobox-option-heading">
                        <span className="combobox-option-label">{option.name}</span>
                        <span className="badge">{option.kind}</span>
                      </div>
                      <span className="combobox-option-description">
                        {option.reference} - ID {option.gitlabId}
                      </span>
                    </div>
                  </ComboboxOption>
                ))
              ) : (
                <div className={`combobox-empty${errorMessage ? " error" : ""}`}>
                  {loading
                    ? "Loading matching groups and projects..."
                    : errorMessage
                      ? errorMessage
                      : query.trim()
                        ? "No matches yet."
                        : "Search accessible groups and projects to exclude them from the saved group query."}
                </div>
              )}
            </ComboboxOptions>
          ) : null}
        </div>
      </Combobox>

      {disabled ? (
        <span className="field-note">Exclusions apply only to saved group queries.</span>
      ) : (
        <span className="field-note">
          Excluded groups remove their whole subtree. Excluded projects remove only that project.
        </span>
      )}

      {selected.length ? (
        <div className="token-list">
          {selected.map((source) => (
            <button
              className="token"
              key={`${source.kind}-${source.gitlabId}`}
              onClick={() =>
                onChange(
                  selected.filter((entry) => !sameSourceReference(entry, source)),
                )
              }
              type="button"
            >
              <span className="token-label">{source.reference}</span>
              <span className="token-kind">{source.kind}</span>
              <span aria-hidden="true" className="token-remove">
                ×
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getSuggestionDepth(option: SourceSuggestion) {
  const segments = option.reference.split("/").filter(Boolean);

  if (!segments.length) {
    return 0;
  }

  return option.kind === "group" ? Math.max(segments.length - 1, 0) : segments.length - 1;
}
