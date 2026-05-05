"use server";

import { revalidatePath } from "next/cache";
import { resolveSourceSelection } from "@/lib/gitlab";
import { parseRuntimeConfigString } from "@/lib/runtime-config";
import { parseSourceQuery } from "@/lib/source-query";
import {
  addSource,
  addSourceExclusion,
  readSources,
  removeSource,
  saveSourceProjectJiraOverride,
  saveSourceProjectSonarOverride,
  updateSourceDefinition,
} from "@/lib/store";
import type {
  ActionState,
  SavedSourceExclusion,
  SavedSourceProjectJiraOverride,
  SavedSourceProjectSonarOverride,
  RuntimeConfig,
  SourceKind,
} from "@/lib/types";

export async function addSourceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const sourceQueryDefinition = formData.get("sourceQueryDefinition");

  if (typeof sourceQueryDefinition !== "string" || !sourceQueryDefinition.trim()) {
    return {
      status: "error",
      message: "Enter a saved source query or a full GitLab path.",
    };
  }

  try {
    const runtimeConfig = parseRuntimeConfigString(formData.get("runtimeConfig"));
    const parsedQuery = parseSourceQuery(sourceQueryDefinition);
    const [resolved, exclusions, projectJiraOverrides, projectSonarOverrides] = await Promise.all([
      resolveSourceSelection(
        parsedQuery.reference,
        parsedQuery.reference,
        parsedQuery.kind === "source" ? undefined : parsedQuery.kind,
        runtimeConfig,
      ),
      resolveExcludedSourceReferences(parsedQuery.exclusions, runtimeConfig),
      resolveProjectJiraOverrides(parsedQuery.projectJiraOverrides, runtimeConfig),
      resolveProjectSonarOverrides(parsedQuery.projectSonarOverrides, runtimeConfig),
    ]);

    if (resolved.kind === "project" && exclusions.length) {
      return {
        status: "error",
        message: "Only saved groups can exclude nested groups or projects.",
      };
    }

    if (resolved.kind === "group" && parsedQuery.sonarProjectKey) {
      return {
        status: "error",
        message: 'Only saved projects can use "With SonarQube ...".',
      };
    }

    if (resolved.kind === "group" && parsedQuery.jiraProjectKeys.length) {
      return {
        status: "error",
        message: 'Only saved projects can use "With Jira ...".',
      };
    }

    if (resolved.kind === "project" && projectSonarOverrides.length) {
      return {
        status: "error",
        message: 'Only saved groups can use "With SonarQube Project ... = ...".',
      };
    }

    if (resolved.kind === "project" && projectJiraOverrides.length) {
      return {
        status: "error",
        message: 'Only saved groups can use "With Jira Project ... = ...".',
      };
    }

    if (
      exclusions.some(
        (source) => source.kind === resolved.kind && source.gitlabId === resolved.gitlabId,
      )
    ) {
      return {
        status: "error",
        message: "The saved source query cannot exclude the root group or project itself.",
      };
    }

    const result = await addSource({
      exclusions,
      gitlabId: resolved.gitlabId,
      jiraProjectKeys: resolved.kind === "project" ? parsedQuery.jiraProjectKeys : [],
      kind: resolved.kind,
      name: resolved.name,
      projectJiraOverrides,
      projectSonarOverrides,
      reference: resolved.reference,
      sonarProjectKey: resolved.kind === "project" ? parsedQuery.sonarProjectKey : null,
      webUrl: resolved.webUrl,
    });

    revalidatePath("/");

    return {
      status: "success",
      message:
        result === "created"
          ? `Added ${resolved.name}.`
          : result === "updated"
            ? `Updated ${resolved.name}.`
          : `${resolved.name} is already saved.`,
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unable to add that source.",
    };
  }
}

export async function removeSourceAction(formData: FormData) {
  const sourceId = formData.get("sourceId");

  if (typeof sourceId !== "string" || !sourceId) {
    return;
  }

  await removeSource(sourceId);
  revalidatePath("/");
}

export async function updateProjectJiraKeysAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const sourceId = formData.get("sourceId");
  const projectId = formData.get("projectId");
  const projectReference = formData.get("projectReference");
  const jiraProjectKeys = formData.get("jiraProjectKeys");

  if (
    typeof sourceId !== "string" ||
    !sourceId ||
    typeof projectReference !== "string" ||
    !projectReference.trim() ||
    typeof projectId !== "string" ||
    !/^\d+$/.test(projectId)
  ) {
    return {
      status: "error",
      message: "Unable to determine which project Jira keys to update.",
    };
  }

  try {
    await saveSourceProjectJiraOverride(
      sourceId,
      Number(projectId),
      projectReference.trim(),
      typeof jiraProjectKeys === "string" ? jiraProjectKeys : null,
    );
    revalidatePath("/");

    return {
      status: "success",
      message:
        typeof jiraProjectKeys === "string" && jiraProjectKeys.trim()
          ? "Saved the Jira project keys."
          : "Cleared the Jira project keys.",
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Unable to update the Jira project keys.",
    };
  }
}

export async function updateProjectSonarKeyAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const sourceId = formData.get("sourceId");
  const projectId = formData.get("projectId");
  const projectReference = formData.get("projectReference");
  const sonarProjectKey = formData.get("sonarProjectKey");

  if (
    typeof sourceId !== "string" ||
    !sourceId ||
    typeof projectReference !== "string" ||
    !projectReference.trim() ||
    typeof projectId !== "string" ||
    !/^\d+$/.test(projectId)
  ) {
    return {
      status: "error",
      message: "Unable to determine which project SonarQube key to update.",
    };
  }

  try {
    await saveSourceProjectSonarOverride(
      sourceId,
      Number(projectId),
      projectReference.trim(),
      typeof sonarProjectKey === "string" ? sonarProjectKey : null,
    );
    revalidatePath("/");

    return {
      status: "success",
      message:
        typeof sonarProjectKey === "string" && sonarProjectKey.trim()
          ? "Saved the SonarQube project key."
          : "Cleared the SonarQube project key.",
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Unable to update the SonarQube project key.",
    };
  }
}

export async function excludeProjectFromSourceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const sourceId = formData.get("sourceId");
  const projectId = formData.get("projectId");
  const projectName = formData.get("projectName");
  const projectReference = formData.get("projectReference");
  const projectWebUrl = formData.get("projectWebUrl");

  if (
    typeof sourceId !== "string" ||
    !sourceId ||
    typeof projectId !== "string" ||
    !/^\d+$/.test(projectId) ||
    typeof projectName !== "string" ||
    !projectName.trim() ||
    typeof projectReference !== "string" ||
    !projectReference.trim() ||
    typeof projectWebUrl !== "string" ||
    !projectWebUrl.trim()
  ) {
    return {
      status: "error",
      message: "Unable to determine which project to exclude.",
    };
  }

  try {
    await addSourceExclusion(sourceId, {
      gitlabId: Number(projectId),
      kind: "project",
      name: projectName.trim(),
      reference: projectReference.trim(),
      webUrl: projectWebUrl.trim(),
    });
    revalidatePath("/");

    return {
      status: "success",
      message: `Excluded ${projectName.trim()} from the saved query.`,
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Unable to exclude that project from the saved query.",
    };
  }
}

export async function excludeGroupFromSourceAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const sourceId = formData.get("sourceId");
  const groupId = formData.get("groupId");
  const groupName = formData.get("groupName");
  const groupReference = formData.get("groupReference");
  const groupWebUrl = formData.get("groupWebUrl");

  if (
    typeof sourceId !== "string" ||
    !sourceId ||
    typeof groupId !== "string" ||
    !/^\d+$/.test(groupId) ||
    typeof groupName !== "string" ||
    !groupName.trim() ||
    typeof groupReference !== "string" ||
    !groupReference.trim() ||
    typeof groupWebUrl !== "string" ||
    !groupWebUrl.trim()
  ) {
    return {
      status: "error",
      message: "Unable to determine which group to exclude.",
    };
  }

  try {
    await addSourceExclusion(sourceId, {
      gitlabId: Number(groupId),
      kind: "group",
      name: groupName.trim(),
      reference: groupReference.trim(),
      webUrl: groupWebUrl.trim(),
    });
    revalidatePath("/");

    return {
      status: "success",
      message: `Excluded ${groupName.trim()} from the saved query.`,
    };
  } catch (error) {
    return {
      status: "error",
      message:
        error instanceof Error
          ? error.message
          : "Unable to exclude that group from the saved query.",
    };
  }
}

export async function updateGroupDefinitionAction(
  _previousState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const sourceId = formData.get("sourceId");
  const sourceQueryDefinition = formData.get("sourceQueryDefinition");

  if (typeof sourceId !== "string" || !sourceId) {
    return {
      status: "error",
      message: "That saved source no longer exists.",
    };
  }

  if (typeof sourceQueryDefinition !== "string" || !sourceQueryDefinition.trim()) {
    return {
      status: "error",
      message: "Enter a saved group definition.",
    };
  }

  try {
    const existingSource = (await readSources()).find((source) => source.id === sourceId);

    if (!existingSource) {
      return {
        status: "error",
        message: "That saved source no longer exists.",
      };
    }

    if (existingSource.kind !== "group") {
      return {
        status: "error",
        message: "Only saved groups support inline group definition edits.",
      };
    }

    const parsedQuery = parseSourceQuery(sourceQueryDefinition);
    const [resolved, exclusions, projectJiraOverrides, projectSonarOverrides] = await Promise.all([
      resolveSourceSelection(
        parsedQuery.reference,
        parsedQuery.reference,
        parsedQuery.kind === "source" ? undefined : parsedQuery.kind,
      ),
      resolveExcludedSourceReferences(parsedQuery.exclusions),
      resolveProjectJiraOverrides(parsedQuery.projectJiraOverrides),
      resolveProjectSonarOverrides(parsedQuery.projectSonarOverrides),
    ]);

    if (resolved.kind !== "group") {
      return {
        status: "error",
        message: 'Group definitions must start with "Add Group ...".',
      };
    }

    if (resolved.gitlabId !== existingSource.gitlabId) {
      return {
        status: "error",
        message: "Inline edits can refine this saved group, but cannot switch it to a different root group.",
      };
    }

    if (parsedQuery.sonarProjectKey) {
      return {
        status: "error",
        message: 'Saved groups cannot use "With SonarQube ...".',
      };
    }

    if (parsedQuery.jiraProjectKeys.length) {
      return {
        status: "error",
        message: 'Saved groups cannot use "With Jira ...".',
      };
    }

    if (
      exclusions.some(
        (source) => source.kind === resolved.kind && source.gitlabId === resolved.gitlabId,
      )
    ) {
      return {
        status: "error",
        message: "The saved source query cannot exclude the root group itself.",
      };
    }

    await updateSourceDefinition(sourceId, {
      exclusions,
      gitlabId: resolved.gitlabId,
      jiraProjectKeys: [],
      kind: "group",
      name: resolved.name,
      projectJiraOverrides,
      projectSonarOverrides,
      reference: resolved.reference,
      sonarProjectKey: null,
      webUrl: resolved.webUrl,
    });
    revalidatePath("/");

    return {
      status: "success",
      message: "Saved the group definition.",
    };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : "Unable to update that group definition.",
    };
  }
}

async function resolveExcludedSourceReferences(
  sources: { kind: SourceKind; reference: string }[],
  runtimeConfig?: RuntimeConfig | null,
): Promise<SavedSourceExclusion[]> {
  const resolvedSources = await Promise.all(
    sources.map((source) =>
      resolveSourceSelection(
        source.reference,
        source.reference,
        source.kind,
        runtimeConfig,
      ),
    ),
  );

  const uniqueSources = new Map<string, SavedSourceExclusion>();

  for (const source of resolvedSources) {
    uniqueSources.set(`${source.kind}:${source.gitlabId}`, {
      gitlabId: source.gitlabId,
      kind: source.kind,
      name: source.name,
      reference: source.reference,
      webUrl: source.webUrl,
    });
  }

  return [...uniqueSources.values()];
}

async function resolveProjectJiraOverrides(
  overrides: { projectReference: string; jiraProjectKeys: string[] }[],
  runtimeConfig?: RuntimeConfig | null,
): Promise<SavedSourceProjectJiraOverride[]> {
  const resolvedOverrides = await Promise.all(
    overrides.map(async (override) => {
      const project = await resolveSourceSelection(
        override.projectReference,
        override.projectReference,
        "project",
        runtimeConfig,
      );

      return {
        gitlabProjectId: project.gitlabId,
        jiraProjectKeys: override.jiraProjectKeys,
        projectReference: project.reference,
      };
    }),
  );

  const uniqueOverrides = new Map<string, SavedSourceProjectJiraOverride>();

  for (const override of resolvedOverrides) {
    uniqueOverrides.set(override.projectReference.toLowerCase(), override);
  }

  return [...uniqueOverrides.values()];
}

async function resolveProjectSonarOverrides(
  overrides: { projectReference: string; sonarProjectKey: string }[],
  runtimeConfig?: RuntimeConfig | null,
): Promise<SavedSourceProjectSonarOverride[]> {
  const resolvedOverrides = await Promise.all(
    overrides.map(async (override) => {
      const project = await resolveSourceSelection(
        override.projectReference,
        override.projectReference,
        "project",
        runtimeConfig,
      );

      return {
        gitlabProjectId: project.gitlabId,
        projectReference: project.reference,
        sonarProjectKey: override.sonarProjectKey,
      };
    }),
  );

  const uniqueOverrides = new Map<string, SavedSourceProjectSonarOverride>();

  for (const override of resolvedOverrides) {
    uniqueOverrides.set(String(override.gitlabProjectId), override);
  }

  return [...uniqueOverrides.values()];
}
