import { describe, expect, it } from "vitest";
import { buildSourceQuery, parseSourceQuery } from "./source-query";

describe("source query helpers", () => {
  it("builds a canonical saved group query", () => {
    expect(
      buildSourceQuery(
        "group",
        "platform/team",
        [
          { kind: "project", gitlabId: 3, name: "Api", reference: "platform/team/api", webUrl: "https://example.test/api" },
          { kind: "group", gitlabId: 2, name: "Archive", reference: "platform/team/archive", webUrl: "https://example.test/archive" },
        ],
        [],
        null,
        [
          { gitlabProjectId: 12, jiraProjectKeys: ["OPS", "PLAT"], projectReference: "platform/team/api" },
        ],
        [
          { gitlabProjectId: 99, projectReference: "platform/team/web", sonarProjectKey: "team-web" },
        ],
      ),
    ).toBe(
      [
        "Add Group platform/team",
        "Without Group platform/team/archive",
        "Without Project platform/team/api",
        "With Jira Project platform/team/api = OPS, PLAT",
        "With SonarQube Project platform/team/web = team-web",
      ].join("\n"),
    );
  });

  it("parses and normalizes a saved group query with duplicate lines", () => {
    expect(
      parseSourceQuery(
        [
          "Add Group platform/team",
          "Without Projects platform/team/api, platform/team/api",
          "Without Group platform/team/archive",
          "With Jira Project platform/team/api = OPS-1, OPS-2",
          "With Jira Project Platform/Team/API = OPS-9",
          "With SonarQube Project platform/team/web = team-web",
          "With SonarQube Project PLATFORM/TEAM/WEB = team-web-2",
        ].join("\n"),
      ),
    ).toEqual({
      kind: "group",
      reference: "platform/team",
      exclusions: [
        { kind: "group", reference: "platform/team/archive" },
        { kind: "project", reference: "platform/team/api" },
      ],
      jiraProjectKeys: [],
      sonarProjectKey: null,
      projectJiraOverrides: [
        { projectReference: "Platform/Team/API", jiraProjectKeys: ["OPS-9"] },
      ],
      projectSonarOverrides: [
        { projectReference: "PLATFORM/TEAM/WEB", sonarProjectKey: "team-web-2" },
      ],
    });
  });

  it("parses project-level Jira and SonarQube settings", () => {
    expect(
      parseSourceQuery(
        [
          "Add Project platform/team/api",
          "With Jira OPS, plat-2",
          "With SonarQube team-api",
        ].join("\n"),
      ),
    ).toEqual({
      kind: "project",
      reference: "platform/team/api",
      exclusions: [],
      jiraProjectKeys: ["OPS", "PLAT-2"],
      sonarProjectKey: "team-api",
      projectJiraOverrides: [],
      projectSonarOverrides: [],
    });
  });

  it("rejects an invalid root line", () => {
    expect(() => parseSourceQuery("Without Group platform/team")).toThrow(
      'Saved source queries must start with "Add Group ...", "Add Project ...", or "Add Source ...".',
    );
  });
});
