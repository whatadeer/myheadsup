import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedSource } from "./types";

const originalCwd = process.cwd();

const sampleSource: Omit<SavedSource, "id" | "createdAt" | "query"> = {
  exclusions: [],
  gitlabId: 42,
  jiraProjectKeys: [],
  kind: "group",
  name: "Platform",
  projectJiraOverrides: [],
  projectSonarOverrides: [],
  reference: "platform",
  sonarProjectKey: null,
  webUrl: "https://gitlab.example.com/groups/platform",
};

let tempDir = "";

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "myheadsup-store-"));
  process.chdir(tempDir);
  vi.resetModules();
});

afterEach(async () => {
  process.chdir(originalCwd);
  vi.resetModules();

  if (tempDir) {
    await rm(tempDir, { force: true, recursive: true });
    tempDir = "";
  }
});

describe("store undo helpers", () => {
  it("stores the last removed source and restores it", async () => {
    const store = await import("./store");

    await store.addSource(sampleSource);

    const [createdSource] = await store.readSources();
    await store.removeSource(createdSource.id);

    expect(await store.readSources()).toHaveLength(0);
    expect(await store.readLastRemovedSource()).toMatchObject({
      source: {
        id: createdSource.id,
        kind: "group",
        name: "Platform",
        reference: "platform",
      },
    });

    const result = await store.restoreLastRemovedSource();

    expect(result).toMatchObject({
      source: {
        id: createdSource.id,
      },
      status: "restored",
    });
    expect(await store.readLastRemovedSource()).toBeNull();
    expect(await store.readSources()).toMatchObject([
      {
        id: createdSource.id,
        kind: "group",
        name: "Platform",
        reference: "platform",
      },
    ]);
  });

  it("can dismiss the last removed source without restoring it", async () => {
    const store = await import("./store");

    await store.addSource(sampleSource);

    const [createdSource] = await store.readSources();
    await store.removeSource(createdSource.id);
    await store.discardLastRemovedSource();

    expect(await store.readLastRemovedSource()).toBeNull();
    expect(await store.readSources()).toHaveLength(0);
  });
});
