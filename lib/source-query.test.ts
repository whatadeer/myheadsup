import { describe, expect, it } from "vitest";
import { buildSourceQuery, formatSourceQueryExpanded, parseSourceQuery } from "./source-query";

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
        "With Project platform/team/api, Jira = OPS, PLAT",
        "With Project platform/team/web, SonarQube = team-web",
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
          "With Project platform/team/api, Jira = OPS-1, OPS-2",
          "With Jira Project Platform/Team/API = OPS-9",
          "With Project platform/team/web, SonarQube = team-web",
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

  it("parses combined project override lines with Jira and SonarQube together", () => {
    expect(
      parseSourceQuery(
        [
          "Add Group platform/team",
          "With Project platform/team/api, Jira = DPT, DPT2, SonarQube = platform-team-api",
        ].join("\n"),
      ),
    ).toEqual({
      kind: "group",
      reference: "platform/team",
      exclusions: [],
      jiraProjectKeys: [],
      sonarProjectKey: null,
      projectJiraOverrides: [
        { projectReference: "platform/team/api", jiraProjectKeys: ["DPT", "DPT2"] },
      ],
      projectSonarOverrides: [
        { projectReference: "platform/team/api", sonarProjectKey: "platform-team-api" },
      ],
    });
  });

  it("parses expanded exclusion lines with indented continuations", () => {
    expect(
      parseSourceQuery(
        [
          "Add Group platform/team",
          "Without Projects",
          "\tplatform/team/api,",
          "\tplatform/team/web",
        ].join("\n"),
      ),
    ).toEqual({
      kind: "group",
      reference: "platform/team",
      exclusions: [
        { kind: "project", reference: "platform/team/api" },
        { kind: "project", reference: "platform/team/web" },
      ],
      jiraProjectKeys: [],
      sonarProjectKey: null,
      projectJiraOverrides: [],
      projectSonarOverrides: [],
    });
  });

  it("formats exclusions into expanded display mode", () => {
    expect(
      formatSourceQueryExpanded(
        [
          "Add Group platform/team",
          "Without Groups platform/team/archive, platform/team/legacy",
          "Without Projects platform/team/api, platform/team/web",
          "With Project platform/team/api, Jira = OPS, PLAT",
        ].join("\n"),
      ),
    ).toBe(
      [
        "Add Group platform/team",
        "Without Groups",
        "\tplatform/team/archive,",
        "\tplatform/team/legacy",
        "Without Projects",
        "\tplatform/team/api,",
        "\tplatform/team/web",
        "With Project platform/team/api, Jira = OPS, PLAT",
      ].join("\n"),
    );
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
