import type {
  SavedSourceExclusion,
  SavedSourceProjectJiraOverride,
  SavedSourceProjectSonarOverride,
  SourceKind,
} from "./types";
import { normalizeJiraProjectKeys } from "./jira";

type QuerySourceKind = SourceKind | "source";

type ParsedSourceReference = {
  kind: SourceKind;
  reference: string;
};

type ParsedProjectSonarOverride = {
  projectReference: string;
  sonarProjectKey: string;
};

type ParsedProjectJiraOverride = {
  projectReference: string;
  jiraProjectKeys: string[];
};

export type ParsedSourceQuery = {
  kind: QuerySourceKind;
  reference: string;
  exclusions: ParsedSourceReference[];
  jiraProjectKeys: string[];
  sonarProjectKey: string | null;
  projectJiraOverrides: ParsedProjectJiraOverride[];
  projectSonarOverrides: ParsedProjectSonarOverride[];
};

const continuedLinePattern = /^\s+/;

export function buildSourceQuery(
  kind: QuerySourceKind,
  reference: string,
  exclusions: SavedSourceExclusion[] = [],
  jiraProjectKeys: string[] = [],
  sonarProjectKey: string | null = null,
  projectJiraOverrides: SavedSourceProjectJiraOverride[] = [],
  projectSonarOverrides: SavedSourceProjectSonarOverride[] = [],
) {
  const normalizedReference = reference.trim();

  if (!normalizedReference) {
    return "";
  }

  const normalizedExclusions = sortSourceReferences(exclusions);
  const lines = [`Add ${labelSourceKind(kind)} ${normalizedReference}`];

  const excludedGroups = normalizedExclusions
    .filter((source) => source.kind === "group")
    .map((source) => source.reference);
  const excludedProjects = normalizedExclusions
    .filter((source) => source.kind === "project")
    .map((source) => source.reference);

  if (excludedGroups.length) {
    lines.push(
      `Without ${excludedGroups.length === 1 ? "Group" : "Groups"} ${excludedGroups.join(", ")}`,
    );
  }

  if (excludedProjects.length) {
    lines.push(
      `Without ${excludedProjects.length === 1 ? "Project" : "Projects"} ${excludedProjects.join(", ")}`,
    );
  }

  if (kind === "project" && jiraProjectKeys.length) {
    lines.push(`With Jira ${jiraProjectKeys.join(", ")}`);
  }

  if (kind === "project" && sonarProjectKey?.trim()) {
    lines.push(`With SonarQube ${sonarProjectKey.trim()}`);
  }

  for (const override of mergeProjectOverrides(projectJiraOverrides, projectSonarOverrides)) {
    lines.push(formatProjectOverrideLine(override));
  }

  return lines.join("\n");
}

export function formatSourceQueryExpanded(value: string) {
  return toLogicalSourceQueryLines(value)
    .map((line) => formatExpandedSourceQueryLine(line))
    .join("\n");
}

export function sameSourceReference(
  left: Pick<SavedSourceExclusion, "kind" | "gitlabId">,
  right: Pick<SavedSourceExclusion, "kind" | "gitlabId">,
) {
  return left.kind === right.kind && left.gitlabId === right.gitlabId;
}

export function sortSourceReferences<T extends Pick<SavedSourceExclusion, "kind" | "gitlabId" | "reference">>(
  references: T[],
) {
  return [...references].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "group" ? -1 : 1;
    }

    const referenceOrder = left.reference.localeCompare(right.reference, undefined, {
      numeric: true,
      sensitivity: "base",
    });

    if (referenceOrder !== 0) {
      return referenceOrder;
    }

    return left.gitlabId - right.gitlabId;
  });
}

export function sortProjectSonarOverrides<
  T extends Pick<SavedSourceProjectSonarOverride, "gitlabProjectId" | "projectReference" | "sonarProjectKey">,
>(overrides: T[]) {
  return sortProjectOverrides(overrides);
}

export function sortProjectJiraOverrides<
  T extends Pick<SavedSourceProjectJiraOverride, "gitlabProjectId" | "projectReference" | "jiraProjectKeys">,
>(overrides: T[]) {
  return sortProjectOverrides(overrides);
}

function sortProjectOverrides<
  T extends Pick<SavedSourceProjectSonarOverride, "gitlabProjectId" | "projectReference">,
>(overrides: T[]) {
  return [...overrides].sort((left, right) => {
    const referenceOrder = left.projectReference.localeCompare(
      right.projectReference,
      undefined,
      {
        numeric: true,
        sensitivity: "base",
      },
    );

    if (referenceOrder !== 0) {
      return referenceOrder;
    }

    return left.gitlabProjectId - right.gitlabProjectId;
  });
}

export function parseSourceQuery(value: string): ParsedSourceQuery {
  const lines = toLogicalSourceQueryLines(value);

  if (!lines.length) {
    throw new Error("Enter a saved source query or choose a group or project.");
  }

  const rootMatch = /^Add\s+(Source|Group|Project)\s+(.+)$/i.exec(lines[0]);

  if (!rootMatch) {
    throw new Error('Saved source queries must start with "Add Group ...", "Add Project ...", or "Add Source ...".');
  }

  const exclusionMap = new Map<string, ParsedSourceReference>();
  const projectJiraOverrideMap = new Map<string, ParsedProjectJiraOverride>();
  const projectSonarOverrideMap = new Map<string, ParsedProjectSonarOverride>();
  let jiraProjectKeys: string[] = [];
  let sonarProjectKey: string | null = null;

  for (const line of lines.slice(1)) {
    const combinedProjectOverrideMatch = /^With\s+Project\s+(.+)$/i.exec(line);

    if (combinedProjectOverrideMatch) {
      const projectOverride = parseCombinedProjectOverride(combinedProjectOverrideMatch[1] ?? "", line);
      const projectReferenceKey = projectOverride.projectReference.toLowerCase();

      if (projectOverride.jiraProjectKeys.length) {
        projectJiraOverrideMap.set(projectReferenceKey, {
          projectReference: projectOverride.projectReference,
          jiraProjectKeys: projectOverride.jiraProjectKeys,
        });
      }

      if (projectOverride.sonarProjectKey) {
        projectSonarOverrideMap.set(projectReferenceKey, {
          projectReference: projectOverride.projectReference,
          sonarProjectKey: projectOverride.sonarProjectKey,
        });
      }
      continue;
    }

    const projectJiraOverrideMatch = /^With\s+Jira\s+Project\s+(.+?)\s*=\s*(.+)$/i.exec(line);

    if (projectJiraOverrideMatch) {
      const projectReference = projectJiraOverrideMatch[1]?.trim();
      const overrideKeys = normalizeJiraProjectKeys(projectJiraOverrideMatch[2]);

      if (!projectReference || !overrideKeys.length) {
        throw new Error(`Unable to parse saved source query line: ${line}`);
      }

      projectJiraOverrideMap.set(projectReference.toLowerCase(), {
        projectReference,
        jiraProjectKeys: overrideKeys,
      });
      continue;
    }

    const projectOverrideMatch = /^With\s+SonarQube\s+Project\s+(.+?)\s*=\s*(.+)$/i.exec(line);

    if (projectOverrideMatch) {
      const projectReference = projectOverrideMatch[1]?.trim();
      const overrideKey = projectOverrideMatch[2]?.trim();

      if (!projectReference || !overrideKey) {
        throw new Error(`Unable to parse saved source query line: ${line}`);
      }

      projectSonarOverrideMap.set(projectReference.toLowerCase(), {
        projectReference,
        sonarProjectKey: overrideKey,
      });
      continue;
    }

    const jiraMatch = /^With\s+Jira\s+(.+)$/i.exec(line);

    if (jiraMatch) {
      const nextKeys = normalizeJiraProjectKeys(jiraMatch[1]);

      if (!nextKeys.length) {
        throw new Error(`Unable to parse saved source query line: ${line}`);
      }

      jiraProjectKeys = nextKeys;
      continue;
    }

    const sonarMatch = /^With\s+SonarQube\s+(.+)$/i.exec(line);

    if (sonarMatch) {
      const nextKey = sonarMatch[1]?.trim();

      if (!nextKey) {
        throw new Error(`Unable to parse saved source query line: ${line}`);
      }

      sonarProjectKey = nextKey;
      continue;
    }

    const exclusionMatch = /^Without\s+(Group|Groups|Project|Projects)\s+(.+)$/i.exec(line);

    if (exclusionMatch) {
      const kind = exclusionMatch[1].toLowerCase().startsWith("group") ? "group" : "project";
      const references = exclusionMatch[2]
        .split(",")
        .map((reference) => reference.trim())
        .filter(Boolean);

      if (!references.length) {
        throw new Error(`Unable to parse saved source query line: ${line}`);
      }

      for (const reference of references) {
        exclusionMap.set(`${kind}:${reference.toLowerCase()}`, {
          kind,
          reference,
        });
      }
      continue;
    }

    throw new Error(`Unable to parse saved source query line: ${line}`);
  }

  return {
    kind: rootMatch[1].toLowerCase() as QuerySourceKind,
    reference: rootMatch[2].trim(),
    exclusions: sortSourceReferences([...exclusionMap.values()].map((source, index) => ({
      ...source,
      gitlabId: index,
    }))).map(({ kind, reference }) => ({
      kind,
      reference,
    })),
    jiraProjectKeys,
    sonarProjectKey,
    projectJiraOverrides: sortProjectJiraOverrides(
      [...projectJiraOverrideMap.values()].map((override, index) => ({
        ...override,
        gitlabProjectId: index,
      })),
    ).map(({ projectReference, jiraProjectKeys: overrideKeys }) => ({
      projectReference,
      jiraProjectKeys: overrideKeys,
    })),
    projectSonarOverrides: sortProjectSonarOverrides(
      [...projectSonarOverrideMap.values()].map((override, index) => ({
        ...override,
        gitlabProjectId: index,
      })),
    ).map(({ projectReference, sonarProjectKey: overrideKey }) => ({
      projectReference,
      sonarProjectKey: overrideKey,
    })),
  };
}

function labelSourceKind(kind: QuerySourceKind) {
  switch (kind) {
    case "group":
      return "Group";
    case "project":
      return "Project";
    default:
      return "Source";
  }
}

function mergeProjectOverrides(
  projectJiraOverrides: SavedSourceProjectJiraOverride[],
  projectSonarOverrides: SavedSourceProjectSonarOverride[],
) {
  const overrides = new Map<
    string,
    {
      gitlabProjectId: number;
      projectReference: string;
      jiraProjectKeys: string[];
      sonarProjectKey: string | null;
    }
  >();

  for (const override of sortProjectJiraOverrides(projectJiraOverrides)) {
    const key = override.projectReference.toLowerCase();
    const existing = overrides.get(key);
    overrides.set(key, {
      gitlabProjectId: existing?.gitlabProjectId ?? override.gitlabProjectId,
      projectReference: override.projectReference,
      jiraProjectKeys: override.jiraProjectKeys,
      sonarProjectKey: existing?.sonarProjectKey ?? null,
    });
  }

  for (const override of sortProjectSonarOverrides(projectSonarOverrides)) {
    const key = override.projectReference.toLowerCase();
    const existing = overrides.get(key);
    overrides.set(key, {
      gitlabProjectId: existing?.gitlabProjectId ?? override.gitlabProjectId,
      projectReference: override.projectReference,
      jiraProjectKeys: existing?.jiraProjectKeys ?? [],
      sonarProjectKey: override.sonarProjectKey,
    });
  }

  return [...overrides.values()].sort((left, right) => {
    const referenceOrder = left.projectReference.localeCompare(right.projectReference, undefined, {
      numeric: true,
      sensitivity: "base",
    });

    if (referenceOrder !== 0) {
      return referenceOrder;
    }

    return left.gitlabProjectId - right.gitlabProjectId;
  });
}

function formatProjectOverrideLine(override: {
  projectReference: string;
  jiraProjectKeys: string[];
  sonarProjectKey: string | null;
}) {
  const segments = [`With Project ${override.projectReference}`];

  if (override.jiraProjectKeys.length) {
    segments.push(`Jira = ${override.jiraProjectKeys.join(", ")}`);
  }

  if (override.sonarProjectKey) {
    segments.push(`SonarQube = ${override.sonarProjectKey}`);
  }

  return segments.join(", ");
}

function parseCombinedProjectOverride(value: string, originalLine: string) {
  const segments = value
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);

  const projectReference = segments.shift()?.trim() ?? "";

  if (!projectReference || !segments.length) {
    throw new Error(`Unable to parse saved source query line: ${originalLine}`);
  }

  let jiraProjectKeys: string[] = [];
  let sonarProjectKey: string | null = null;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] ?? "";
    const jiraMatch = /^Jira\s*=\s*(.+)$/i.exec(segment);

    if (jiraMatch) {
      const jiraSegments = [jiraMatch[1] ?? ""];

      while (index + 1 < segments.length && !/^(Jira|SonarQube)\s*=/i.test(segments[index + 1] ?? "")) {
        jiraSegments.push(segments[index + 1] ?? "");
        index += 1;
      }

      const nextKeys = normalizeJiraProjectKeys(jiraSegments.join(", "));
      if (!nextKeys.length) {
        throw new Error(`Unable to parse saved source query line: ${originalLine}`);
      }

      jiraProjectKeys = nextKeys;
      continue;
    }

    const sonarMatch = /^SonarQube\s*=\s*(.+)$/i.exec(segment);
    if (sonarMatch) {
      const nextKey = sonarMatch[1]?.trim();
      if (!nextKey) {
        throw new Error(`Unable to parse saved source query line: ${originalLine}`);
      }

      sonarProjectKey = nextKey;
      continue;
    }

    throw new Error(`Unable to parse saved source query line: ${originalLine}`);
  }

  if (!jiraProjectKeys.length && !sonarProjectKey) {
    throw new Error(`Unable to parse saved source query line: ${originalLine}`);
  }

  return {
    projectReference,
    jiraProjectKeys,
    sonarProjectKey,
  };
}

function toLogicalSourceQueryLines(value: string) {
  const lines: string[] = [];

  for (const rawLine of value.split(/\r?\n/)) {
    const trimmedLine = rawLine.trim();

    if (!trimmedLine) {
      continue;
    }

    if (continuedLinePattern.test(rawLine) && lines.length) {
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${trimmedLine}`;
      continue;
    }

    lines.push(trimmedLine);
  }

  return lines;
}

function formatExpandedSourceQueryLine(line: string) {
  const exclusionMatch = /^(Without\s+(?:Group|Groups|Project|Projects))\s+(.+)$/i.exec(line);

  if (!exclusionMatch) {
    return line;
  }

  const references = exclusionMatch[1] && exclusionMatch[2]
    ? exclusionMatch[2]
        .split(",")
        .map((reference) => reference.trim())
        .filter(Boolean)
    : [];

  if (!references.length) {
    return line;
  }

  return `${exclusionMatch[1]}\n${references
    .map((reference, index) => `\t${reference}${index < references.length - 1 ? "," : ""}`)
    .join("\n")}`;
}
