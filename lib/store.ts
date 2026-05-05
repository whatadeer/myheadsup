import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildSourceQuery,
  sortProjectJiraOverrides,
  sameSourceReference,
  sortProjectSonarOverrides,
  sortSourceReferences,
} from "./source-query";
import { normalizeJiraProjectKeys } from "./jira";
import type {
  SavedSource,
  SavedSourceExclusion,
  SavedSourceProjectJiraOverride,
  SavedSourceProjectSonarOverride,
} from "./types";

const dataDirectory = path.join(process.cwd(), "data");
const dataFile = path.join(dataDirectory, "sources.json");

type StoreShape = {
  sources: SavedSource[];
};

export async function readSources() {
  const store = await readStore();
  return [...store.sources].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

export async function addSource(
  source: Omit<SavedSource, "id" | "createdAt" | "query">,
): Promise<"created" | "duplicate" | "updated"> {
  const store = await readStore();
  const normalizedSource = normalizeSource(source);
  const existingSource = store.sources.find(
    (entry) =>
      entry.kind === normalizedSource.kind && entry.gitlabId === normalizedSource.gitlabId,
  );

  if (existingSource) {
    if (!areSourcesEquivalent(existingSource, normalizedSource)) {
      existingSource.name = normalizedSource.name;
      existingSource.reference = normalizedSource.reference;
      existingSource.query = normalizedSource.query;
      existingSource.exclusions = normalizedSource.exclusions;
      existingSource.projectJiraOverrides = normalizedSource.projectJiraOverrides;
      existingSource.projectSonarOverrides = normalizedSource.projectSonarOverrides;
      existingSource.jiraProjectKeys = normalizedSource.jiraProjectKeys;
      existingSource.sonarProjectKey = normalizedSource.sonarProjectKey;
      existingSource.webUrl = normalizedSource.webUrl;
      await writeStore(store);
      return "updated";
    }

    return "duplicate";
  }

  store.sources.push({
    ...normalizedSource,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  });

  await writeStore(store);
  return "created";
}

export async function removeSource(sourceId: string) {
  const store = await readStore();
  const sources = store.sources.filter((source) => source.id !== sourceId);

  if (sources.length === store.sources.length) {
    return;
  }

  await writeStore({ sources });
}

export async function updateSourceDefinition(
  sourceId: string,
  source: Omit<SavedSource, "id" | "createdAt" | "query">,
) {
  const store = await readStore();
  const existingSource = store.sources.find((entry) => entry.id === sourceId);

  if (!existingSource) {
    throw new Error("That saved source no longer exists.");
  }

  const normalizedSource = normalizeSource(source);

  existingSource.kind = normalizedSource.kind;
  existingSource.gitlabId = normalizedSource.gitlabId;
  existingSource.name = normalizedSource.name;
  existingSource.reference = normalizedSource.reference;
  existingSource.query = normalizedSource.query;
  existingSource.exclusions = normalizedSource.exclusions;
  existingSource.projectJiraOverrides = normalizedSource.projectJiraOverrides;
  existingSource.projectSonarOverrides = normalizedSource.projectSonarOverrides;
  existingSource.jiraProjectKeys = normalizedSource.jiraProjectKeys;
  existingSource.sonarProjectKey = normalizedSource.sonarProjectKey;
  existingSource.webUrl = normalizedSource.webUrl;

  await writeStore(store);
}

export async function saveSourceProjectJiraOverride(
  sourceId: string,
  gitlabProjectId: number,
  projectReference: string,
  jiraProjectKeys: string[] | string | null,
) {
  const store = await readStore();
  const source = store.sources.find((entry) => entry.id === sourceId);

  if (!source) {
    throw new Error("That saved source no longer exists.");
  }

  const normalizedKeys = normalizeJiraProjectKeys(jiraProjectKeys);

  if (source.kind === "project") {
    if (source.gitlabId !== gitlabProjectId) {
      throw new Error("That project does not belong to the saved source you are editing.");
    }

    source.jiraProjectKeys = normalizedKeys;
  } else {
    source.projectJiraOverrides = source.projectJiraOverrides.filter(
      (override) => override.gitlabProjectId !== gitlabProjectId,
    );

    if (normalizedKeys.length) {
      source.projectJiraOverrides.push({
        gitlabProjectId,
        jiraProjectKeys: normalizedKeys,
        projectReference: projectReference.trim(),
      });
      source.projectJiraOverrides = sortProjectJiraOverrides(source.projectJiraOverrides);
    }
  }

  source.query = buildSourceQuery(
    source.kind,
    source.reference,
    source.exclusions,
    source.jiraProjectKeys,
    source.sonarProjectKey,
    source.projectJiraOverrides,
    source.projectSonarOverrides,
  );
  await writeStore(store);
}

export async function saveSourceProjectSonarOverride(
  sourceId: string,
  gitlabProjectId: number,
  projectReference: string,
  sonarProjectKey: string | null,
) {
  const store = await readStore();
  const source = store.sources.find((entry) => entry.id === sourceId);

  if (!source) {
    throw new Error("That saved source no longer exists.");
  }

  const normalizedKey =
    typeof sonarProjectKey === "string" && sonarProjectKey.trim()
      ? sonarProjectKey.trim()
      : null;

  if (source.kind === "project") {
    if (source.gitlabId !== gitlabProjectId) {
      throw new Error("That project does not belong to the saved source you are editing.");
    }

    source.sonarProjectKey = normalizedKey;
  } else {
    source.projectSonarOverrides = source.projectSonarOverrides.filter(
      (override) => override.gitlabProjectId !== gitlabProjectId,
    );

    if (normalizedKey) {
      source.projectSonarOverrides.push({
        gitlabProjectId,
        projectReference: projectReference.trim(),
        sonarProjectKey: normalizedKey,
      });
      source.projectSonarOverrides = sortProjectSonarOverrides(source.projectSonarOverrides);
    }
  }

  source.query = buildSourceQuery(
    source.kind,
    source.reference,
    source.exclusions,
    source.jiraProjectKeys,
    source.sonarProjectKey,
    source.projectJiraOverrides,
    source.projectSonarOverrides,
  );
  await writeStore(store);
}

export async function addSourceExclusion(
  sourceId: string,
  exclusion: SavedSourceExclusion,
) {
  const store = await readStore();
  const source = store.sources.find((entry) => entry.id === sourceId);

  if (!source) {
    throw new Error("That saved source no longer exists.");
  }

  if (source.kind !== "group") {
    throw new Error("Only saved groups can exclude projects from the query.");
  }

  if (sameSourceReference(source, exclusion)) {
    throw new Error("The saved source query cannot exclude the root group itself.");
  }

  if (source.exclusions.some((entry) => sameSourceReference(entry, exclusion))) {
    return;
  }

  source.exclusions = sortSourceReferences([...source.exclusions, exclusion]);

  if (exclusion.kind === "project") {
    source.projectJiraOverrides = source.projectJiraOverrides.filter(
      (override) => override.gitlabProjectId !== exclusion.gitlabId,
    );
    source.projectSonarOverrides = source.projectSonarOverrides.filter(
      (override) => override.gitlabProjectId !== exclusion.gitlabId,
    );
  }

  source.query = buildSourceQuery(
    source.kind,
    source.reference,
    source.exclusions,
    source.jiraProjectKeys,
    source.sonarProjectKey,
    source.projectJiraOverrides,
    source.projectSonarOverrides,
  );

  await writeStore(store);
}

async function readStore(): Promise<StoreShape> {
  await ensureStore();

  const raw = await readFile(dataFile, "utf8");
  const parsed = JSON.parse(raw) as Partial<StoreShape>;

  return {
    sources: Array.isArray(parsed.sources)
        ? parsed.sources.map((source) => ({
            ...source,
            exclusions: normalizeExclusions(source?.exclusions),
            projectJiraOverrides: normalizeProjectJiraOverrides(source?.projectJiraOverrides),
            projectSonarOverrides: normalizeProjectSonarOverrides(source?.projectSonarOverrides),
            query:
              typeof source?.query === "string" && source.query.trim()
              ? source.query.trim()
              : buildSourceQuery(
                  source?.kind === "group" || source?.kind === "project"
                    ? source.kind
                   : "source",
                   typeof source?.reference === "string" ? source.reference : "",
                   normalizeExclusions(source?.exclusions),
                   source?.kind === "project"
                     ? normalizeJiraProjectKeys(source?.jiraProjectKeys)
                     : [],
                   source?.kind === "project" &&
                     typeof source?.sonarProjectKey === "string" &&
                     source.sonarProjectKey.trim()
                     ? source.sonarProjectKey.trim()
                     : null,
                   normalizeProjectJiraOverrides(source?.projectJiraOverrides),
                   normalizeProjectSonarOverrides(source?.projectSonarOverrides),
                 ),
          jiraProjectKeys:
            source?.kind === "project"
              ? normalizeJiraProjectKeys(source?.jiraProjectKeys)
              : [],
          sonarProjectKey:
            source?.kind === "project" &&
            typeof source?.sonarProjectKey === "string" &&
            source.sonarProjectKey.trim()
              ? source.sonarProjectKey.trim()
              : null,
        }))
      : [],
  };
}

async function writeStore(store: StoreShape) {
  await ensureStore();
  await writeFile(dataFile, JSON.stringify(store, null, 2), "utf8");
}

function normalizeSource(source: Omit<SavedSource, "id" | "createdAt" | "query">) {
  const exclusions = normalizeExclusions(source.exclusions);
  const projectJiraOverrides = normalizeProjectJiraOverrides(source.projectJiraOverrides);
  const projectSonarOverrides = normalizeProjectSonarOverrides(source.projectSonarOverrides);
  const jiraProjectKeys = source.kind === "project" ? normalizeJiraProjectKeys(source.jiraProjectKeys) : [];
  const sonarProjectKey =
    source.kind === "project" &&
    typeof source.sonarProjectKey === "string" &&
    source.sonarProjectKey.trim()
      ? source.sonarProjectKey.trim()
      : null;

  return {
    ...source,
    exclusions,
    projectJiraOverrides,
    projectSonarOverrides,
    query: buildSourceQuery(
      source.kind,
      source.reference,
      exclusions,
      jiraProjectKeys,
      sonarProjectKey,
      projectJiraOverrides,
      projectSonarOverrides,
    ),
    jiraProjectKeys,
    sonarProjectKey,
  };
}

function normalizeProjectJiraOverrides(value: unknown): SavedSourceProjectJiraOverride[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return sortProjectJiraOverrides(
    value.filter(isSavedSourceProjectJiraOverride).map((override) => ({
      gitlabProjectId: override.gitlabProjectId,
      jiraProjectKeys: normalizeJiraProjectKeys(override.jiraProjectKeys),
      projectReference: override.projectReference.trim(),
    })),
  );
}

function isSavedSourceProjectJiraOverride(
  value: unknown,
): value is SavedSourceProjectJiraOverride {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.gitlabProjectId === "number" &&
    typeof candidate.projectReference === "string" &&
    candidate.projectReference.trim().length > 0 &&
    Array.isArray(candidate.jiraProjectKeys) &&
    candidate.jiraProjectKeys.every((key) => typeof key === "string" && key.trim().length > 0)
  );
}

function normalizeProjectSonarOverrides(value: unknown): SavedSourceProjectSonarOverride[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return sortProjectSonarOverrides(
    value.filter(isSavedSourceProjectSonarOverride).map((override) => ({
      gitlabProjectId: override.gitlabProjectId,
      projectReference: override.projectReference.trim(),
      sonarProjectKey: override.sonarProjectKey.trim(),
    })),
  );
}

function isSavedSourceProjectSonarOverride(
  value: unknown,
): value is SavedSourceProjectSonarOverride {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.gitlabProjectId === "number" &&
    typeof candidate.projectReference === "string" &&
    candidate.projectReference.trim().length > 0 &&
    typeof candidate.sonarProjectKey === "string" &&
    candidate.sonarProjectKey.trim().length > 0
  );
}

function normalizeExclusions(value: unknown): SavedSourceExclusion[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return sortSourceReferences(
    value.filter(isSavedSourceExclusion).map((source) => ({
      gitlabId: source.gitlabId,
      kind: source.kind,
      name: source.name.trim(),
      reference: source.reference.trim(),
      webUrl: source.webUrl.trim(),
    })),
  );
}

function isSavedSourceExclusion(value: unknown): value is SavedSourceExclusion {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    (candidate.kind === "group" || candidate.kind === "project") &&
    typeof candidate.gitlabId === "number" &&
    typeof candidate.name === "string" &&
    typeof candidate.reference === "string" &&
    typeof candidate.webUrl === "string"
  );
}

function areSourcesEquivalent(
  left: SavedSource,
  right: ReturnType<typeof normalizeSource>,
) {
  return (
    left.name === right.name &&
    left.reference === right.reference &&
    left.query === right.query &&
    haveSameProjectJiraOverrides(left.projectJiraOverrides, right.projectJiraOverrides) &&
    haveSameProjectSonarOverrides(left.projectSonarOverrides, right.projectSonarOverrides) &&
    haveSameJiraProjectKeys(left.jiraProjectKeys, right.jiraProjectKeys) &&
    left.sonarProjectKey === right.sonarProjectKey &&
    left.webUrl === right.webUrl &&
    haveSameExclusions(left.exclusions, right.exclusions)
  );
}

function haveSameProjectJiraOverrides(
  left: SavedSourceProjectJiraOverride[],
  right: SavedSourceProjectJiraOverride[],
) {
  return (
    left.length === right.length &&
    left.every((override, index) => {
      const otherOverride = right[index];
      return (
        Boolean(otherOverride) &&
        override.gitlabProjectId === otherOverride.gitlabProjectId &&
        override.projectReference === otherOverride.projectReference &&
        haveSameJiraProjectKeys(override.jiraProjectKeys, otherOverride.jiraProjectKeys)
      );
    })
  );
}

function haveSameProjectSonarOverrides(
  left: SavedSourceProjectSonarOverride[],
  right: SavedSourceProjectSonarOverride[],
) {
  return (
    left.length === right.length &&
    left.every((override, index) => {
      const otherOverride = right[index];
      return (
        Boolean(otherOverride) &&
        override.gitlabProjectId === otherOverride.gitlabProjectId &&
        override.projectReference === otherOverride.projectReference &&
        override.sonarProjectKey === otherOverride.sonarProjectKey
      );
    })
  );
}

function haveSameExclusions(left: SavedSourceExclusion[], right: SavedSourceExclusion[]) {
  return (
    left.length === right.length &&
    left.every((source, index) => {
      const otherSource = right[index];
      return (
        Boolean(otherSource) &&
        sameSourceReference(source, otherSource) &&
        source.reference === otherSource.reference &&
        source.name === otherSource.name &&
        source.webUrl === otherSource.webUrl
      );
    })
  );
}

function haveSameJiraProjectKeys(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((key, index) => key === right[index])
  );
}

async function ensureStore() {
  await mkdir(dataDirectory, { recursive: true });

  try {
    await readFile(dataFile, "utf8");
  } catch {
    await writeFile(
      dataFile,
      JSON.stringify({ sources: [] }, null, 2),
      "utf8",
    );
  }
}
