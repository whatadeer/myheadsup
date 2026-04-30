"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from "@headlessui/react";
import { useReferenceSuggestions } from "@/components/use-reference-suggestions";
import type { RuntimeConfig, SourceSuggestion } from "@/lib/types";

type ReferenceComboboxProps = {
  id: string;
  label: string;
  name: string;
  placeholder: string;
  onChange: (value: string, suggestion: SourceSuggestion | null) => void;
  required?: boolean;
  runtimeConfig?: RuntimeConfig | null;
};

export function ReferenceCombobox({
  id,
  label,
  name,
  placeholder,
  onChange,
  required = true,
  runtimeConfig,
}: ReferenceComboboxProps) {
  const [query, setQuery] = useState("");
  const { errorMessage, loading, options } = useReferenceSuggestions(query, runtimeConfig);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>

      <Combobox
        immediate
        onChange={(nextValue: SourceSuggestion | null) => {
          if (!nextValue) {
            return;
          }

          setQuery(nextValue.reference);
          onChange(nextValue.reference, nextValue);
        }}
        value={null}
      >
        <div className="combobox">
          <div className="combobox-control">
            <ComboboxInput
              autoComplete="off"
              className="input combobox-input"
              displayValue={(currentValue: SourceSuggestion | null) =>
                currentValue?.reference ?? query
              }
              id={id}
              name={name}
              onChange={(event) => {
                const nextValue = event.target.value;
                setQuery(nextValue);
                onChange(nextValue, null);
              }}
              placeholder={placeholder}
              required={required}
            />

            <ComboboxButton
              aria-label="Show matching groups and projects"
              className="combobox-button"
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

          <ComboboxOptions className="combobox-options" portal={false}>
            {options.length ? (
              options.map((option) => (
                <ComboboxOption
                  className={({ focus, selected }) =>
                    `combobox-option combobox-option-${option.kind}${focus ? " active" : ""}${selected ? " selected" : ""}`
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
                  {({ selected }) => (
                    <>
                      <div className="combobox-option-copy">
                        <div className="combobox-option-heading">
                          <span className="combobox-option-label">{option.name}</span>
                          <span className="badge">{option.kind}</span>
                        </div>
                        <span className="combobox-option-description">
                          {option.reference} - ID {option.gitlabId}
                        </span>
                      </div>
                      {selected ? <span className="combobox-option-check">Selected</span> : null}
                    </>
                  )}
                </ComboboxOption>
              ))
            ) : (
              <div className={`combobox-empty${errorMessage ? " error" : ""}`}>
                {loading
                  ? "Loading matching groups and projects..."
                  : errorMessage
                    ? errorMessage
                    : query.trim()
                      ? `No matches yet. Press Enter to use "${query.trim()}".`
                      : "Browse accessible groups and projects together, or start typing to search."}
              </div>
            )}
          </ComboboxOptions>
        </div>
      </Combobox>
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
