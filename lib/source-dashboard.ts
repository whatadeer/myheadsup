import { summarizeGroup } from "./group-summary";
import type { GroupNode, ProjectSummary, SavedSource, SourceDashboard } from "./types";

export type BaseSourceDashboard =
  | {
      kind: "project";
      project: ProjectSummary;
    }
  | {
      kind: "group";
      group: GroupNode;
    }
  | {
      error: string;
    };

export function materializeSourceDashboard(
  savedSource: SavedSource,
  baseDashboard: BaseSourceDashboard,
): SourceDashboard {
  if ("error" in baseDashboard) {
    return {
      savedSource,
      error: baseDashboard.error,
    };
  }

  if (baseDashboard.kind === "project") {
    return {
      kind: "project",
      savedSource,
      project: baseDashboard.project,
    };
  }

  const filteredGroup = applyGroupExclusions(baseDashboard.group, savedSource.exclusions);

  if (!filteredGroup) {
    return {
      savedSource,
      error: "This saved source excludes the root group itself.",
    };
  }

  return {
    kind: "group",
    savedSource,
    group: filteredGroup,
  };
}

export function reconcileDashboardsWithSavedSources(
  currentDashboards: SourceDashboard[],
  savedSources: SavedSource[],
) {
  const currentBySourceId = new Map(
    currentDashboards.map((dashboard) => [dashboard.savedSource.id, dashboard]),
  );

  return savedSources.flatMap((savedSource) => {
    const currentDashboard = currentBySourceId.get(savedSource.id);

    if (!currentDashboard) {
      return [];
    }

    if ("error" in currentDashboard) {
      return [
        {
          ...currentDashboard,
          savedSource,
        },
      ];
    }

    if (currentDashboard.kind !== savedSource.kind) {
      return [];
    }

    if (currentDashboard.kind === "project") {
      return [
        {
          ...currentDashboard,
          savedSource,
        },
      ];
    }

    return [materializeSourceDashboard(savedSource, currentDashboard)];
  });
}

function applyGroupExclusions(
  group: GroupNode,
  exclusions: SavedSource["exclusions"],
): GroupNode | null {
  if (!exclusions.length) {
    return group;
  }

  const excludedGroupIds = new Set(
    exclusions.filter((source) => source.kind === "group").map((source) => source.gitlabId),
  );
  const excludedProjectIds = new Set(
    exclusions.filter((source) => source.kind === "project").map((source) => source.gitlabId),
  );

  return pruneGroupNode(group, excludedGroupIds, excludedProjectIds);
}

function pruneGroupNode(
  group: GroupNode,
  excludedGroupIds: Set<number>,
  excludedProjectIds: Set<number>,
): GroupNode | null {
  if (excludedGroupIds.has(group.id)) {
    return null;
  }

  const projects = group.projects.filter((project) => !excludedProjectIds.has(project.id));
  const subgroups = group.subgroups
    .map((subgroup) => pruneGroupNode(subgroup, excludedGroupIds, excludedProjectIds))
    .filter((subgroup): subgroup is GroupNode => Boolean(subgroup));

  return {
    ...group,
    projects,
    subgroups,
    summary: summarizeGroup(projects, subgroups),
  };
}
