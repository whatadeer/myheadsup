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

  for (const override of sortProjectJiraOverrides(projectJiraOverrides)) {
    lines.push(`With Jira Project ${override.projectReference} = ${override.jiraProjectKeys.join(", ")}`);
  }

  for (const override of sortProjectSonarOverrides(projectSonarOverrides)) {
    lines.push(`With SonarQube Project ${override.projectReference} = ${override.sonarProjectKey}`);
  }

  return lines.join("\n");
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
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

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
