import { describe, expect, it } from "vitest";
import { summarizeDependencyVulnerabilities } from "./dependency-vulnerabilities";

describe("dependency vulnerability parsing", () => {
  it("counts dependency dashboard updates by bracketed severity", () => {
    expect(
      summarizeDependencyVulnerabilities([
        {
          description: [
            "This issue lists Renovate updates and detected dependencies.",
            "- [ ] Update dependency @angular/compiler to v21.2.4 [SECURITY]",
            "- [x] Update dependency @angular/core to v21.2.4 [security]",
            "- [ ] Update dependency rxjs to v8.0.0 [HIGH]",
          ].join("\n"),
          id: 42,
          iid: 7,
          title: "Dependency Dashboard",
          webUrl: "https://example.test/group/project/-/issues/7",
        },
      ]),
    ).toEqual({
      bySeverity: {
        HIGH: 1,
        SECURITY: 2,
      },
      items: [
        { packageName: "@angular/compiler", severity: "SECURITY" },
        { packageName: "@angular/core", severity: "SECURITY" },
        { packageName: "rxjs", severity: "HIGH" },
      ],
      issueId: 42,
      issueIid: 7,
      issueTitle: "Dependency Dashboard",
      issueWebUrl: "https://example.test/group/project/-/issues/7",
      totalCount: 3,
    });
  });

  it("counts severity tags on renovate lines with checkboxes and html comments", () => {
    expect(
      summarizeDependencyVulnerabilities([
        {
          description: [
            "This issue lists Renovate updates and detected dependencies.",
            "",
            "## Other Branches",
            "",
            " - [ ] <!-- other-branch=renovate/npm-angular-compiler-vulnerability -->Update dependency @angular/compiler to v21.2.4 [SECURITY]",
            " - [ ] <!-- other-branch=renovate/npm-angular-core-vulnerability -->Update dependency @angular/core to v21.2.4 [SECURITY]",
          ].join("\n"),
          id: 100,
          iid: 8,
          title: "Dependency Dashboard",
          webUrl: "https://example.test/group/project/-/issues/8",
        },
      ]),
    ).toEqual({
      bySeverity: {
        SECURITY: 2,
      },
      items: [
        { packageName: "@angular/compiler", severity: "SECURITY" },
        { packageName: "@angular/core", severity: "SECURITY" },
      ],
      issueId: 100,
      issueIid: 8,
      issueTitle: "Dependency Dashboard",
      issueWebUrl: "https://example.test/group/project/-/issues/8",
      totalCount: 2,
    });
  });

  it("counts vulnerabilities from both other branches and open markdown-linked items", () => {
    expect(
      summarizeDependencyVulnerabilities([
        {
          description: [
            "## Other Branches",
            " - [ ] <!-- other-branch=renovate/npm-angular-compiler-vulnerability -->Update dependency @angular/compiler to v21.2.4 [SECURITY]",
            " - [ ] <!-- other-branch=renovate/npm-angular-core-vulnerability -->Update dependency @angular/core to v21.2.4 [SECURITY]",
            "",
            "## Open",
            " - [ ] <!-- rebase-branch=renovate/nuget-mailkit-vulnerability -->[Update dependency MailKit to 4.16.0 [SECURITY]](!303)",
          ].join("\n"),
          id: 101,
          iid: 9,
          title: "Dependency Dashboard",
          webUrl: "https://example.test/group/project/-/issues/9",
        },
      ]),
    ).toEqual({
      bySeverity: {
        SECURITY: 3,
      },
      items: [
        { packageName: "@angular/compiler", severity: "SECURITY" },
        { packageName: "@angular/core", severity: "SECURITY" },
        { packageName: "MailKit", severity: "SECURITY" },
      ],
      issueId: 101,
      issueIid: 9,
      issueTitle: "Dependency Dashboard",
      issueWebUrl: "https://example.test/group/project/-/issues/9",
      totalCount: 3,
    });
  });

  it("ignores non-dashboard issues and update lines without a bracketed severity", () => {
    expect(
      summarizeDependencyVulnerabilities([
        {
          description: "- [ ] Update dependency next to v16.2.5",
          id: 10,
          iid: 3,
          title: "Dependency Dashboard",
          webUrl: "https://example.test/group/project/-/issues/3",
        },
        {
          description: "- [ ] Update dependency react to v20.0.0 [SECURITY]",
          id: 11,
          iid: 4,
          title: "Regular issue",
          webUrl: "https://example.test/group/project/-/issues/4",
        },
      ]),
    ).toBeNull();
  });
});
