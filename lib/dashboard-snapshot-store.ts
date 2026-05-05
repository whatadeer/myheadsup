import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BaseSourceDashboard } from "./source-dashboard";

type DashboardSnapshotEntry = {
  baseDashboard: BaseSourceDashboard;
  fetchedAt: string;
};

type DashboardSnapshotStoreShape = {
  snapshots: Record<string, DashboardSnapshotEntry>;
};

const dataDirectory = path.join(process.cwd(), "data");
const snapshotFile = path.join(dataDirectory, "dashboard-snapshots.json");
const maxSnapshotEntries = 500;
const maxSnapshotAgeMs = 30 * 24 * 60 * 60 * 1000;

let snapshotWriteQueue = Promise.resolve();

export async function readDashboardSnapshotEntries() {
  const store = await readSnapshotStore();
  return store.snapshots;
}

export async function writeDashboardSnapshot(
  cacheKey: string,
  baseDashboard: BaseSourceDashboard,
  fetchedAt: string,
) {
  await enqueueSnapshotWrite((store) => {
    store.snapshots[cacheKey] = {
      baseDashboard,
      fetchedAt,
    };
    pruneSnapshots(store);
    return store;
  });
}

async function enqueueSnapshotWrite(
  updateStore: (store: DashboardSnapshotStoreShape) => DashboardSnapshotStoreShape,
) {
  snapshotWriteQueue = snapshotWriteQueue.then(async () => {
    const store = await readSnapshotStore();
    await writeSnapshotStore(updateStore(store));
  });

  await snapshotWriteQueue;
}

async function readSnapshotStore(): Promise<DashboardSnapshotStoreShape> {
  await ensureSnapshotStore();

  try {
    const raw = await readFile(snapshotFile, "utf8");
    return normalizeSnapshotStore(JSON.parse(raw) as unknown);
  } catch {
    return { snapshots: {} };
  }
}

async function writeSnapshotStore(store: DashboardSnapshotStoreShape) {
  await ensureSnapshotStore();
  await writeFile(snapshotFile, JSON.stringify(store, null, 2), "utf8");
}

async function ensureSnapshotStore() {
  await mkdir(dataDirectory, { recursive: true });

  try {
    await readFile(snapshotFile, "utf8");
  } catch {
    await writeFile(snapshotFile, JSON.stringify({ snapshots: {} }, null, 2), "utf8");
  }
}

function normalizeSnapshotStore(value: unknown): DashboardSnapshotStoreShape {
  if (!value || typeof value !== "object") {
    return { snapshots: {} };
  }

  const candidate = value as { snapshots?: unknown };
  if (!candidate.snapshots || typeof candidate.snapshots !== "object" || Array.isArray(candidate.snapshots)) {
    return { snapshots: {} };
  }

  const snapshots = Object.fromEntries(
    Object.entries(candidate.snapshots).filter(([, entry]) => isDashboardSnapshotEntry(entry)),
  );

  return {
    snapshots,
  };
}

function isDashboardSnapshotEntry(value: unknown): value is DashboardSnapshotEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.fetchedAt === "string" &&
    Boolean(candidate.fetchedAt.trim()) &&
    typeof candidate.baseDashboard === "object" &&
    candidate.baseDashboard !== null
  );
}

function pruneSnapshots(store: DashboardSnapshotStoreShape) {
  const cutoff = Date.now() - maxSnapshotAgeMs;
  const entries = Object.entries(store.snapshots)
    .filter(([, entry]) => {
      const fetchedAt = Date.parse(entry.fetchedAt);
      return Number.isFinite(fetchedAt) && fetchedAt >= cutoff;
    })
    .sort((left, right) => left[1].fetchedAt.localeCompare(right[1].fetchedAt));

  const trimmedEntries = entries.slice(Math.max(entries.length - maxSnapshotEntries, 0));
  store.snapshots = Object.fromEntries(trimmedEntries);
}
