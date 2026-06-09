import { createHash } from "node:crypto";
import fs from "node:fs";
import { atomicWriteFileSync, expandHome } from "@m3/config";

/**
 * Persisted trust record for plugin files. Trust-on-first-use: the
 * first time a plugin file is loaded, its SHA256 is recorded. Every
 * subsequent load is compared against the recorded SHA — a mismatch
 * (file replaced, tampered with, partially downloaded) refuses to
 * load the plugin and surfaces a clear error.
 *
 * Path-keyed: the same plugin id can be loaded from different paths
 * (e.g. test fixtures, monorepo dev). Each path is tracked
 * independently.
 */
export type PluginShaRecord = {
  /** Absolute path of the plugin entry file. */
  path: string;
  /** SHA256 of the file contents at trust time. */
  sha256: string;
  /** Plugin id declared by the module (filled in after first load). */
  pluginId: string;
  /** ISO timestamp of first load. */
  firstSeenAt: string;
};

export type PluginShaStore = {
  records: Record<string, PluginShaRecord>;
};

const DEFAULT_DB_PATH = "~/.m3/plugin-shas.json";

/** Compute the SHA256 of a file's contents. */
export function sha256OfFile(absPath: string): string {
  const buf = fs.readFileSync(absPath);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Load the persisted SHA store. Returns an empty store if the file
 * doesn't exist or is corrupt (corrupt → log to stderr, start fresh).
 */
export function loadPluginShaStore(dbPath: string = DEFAULT_DB_PATH): PluginShaStore {
  const resolved = expandHome(dbPath);
  if (!fs.existsSync(resolved)) return { records: {} };
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8")) as PluginShaStore;
  } catch (err) {
    process.stderr.write(
      `[m3:plugins] plugin-shas.json corrupt: ${err instanceof Error ? err.message : err}; starting fresh\n`,
    );
    return { records: {} };
  }
}

/** Persist the SHA store atomically at 0o600 (it's not a secret but
 *  it's a config-modifying file in ~/.m3/ and we keep the modes
 *  consistent). */
export function savePluginShaStore(store: PluginShaStore, dbPath: string = DEFAULT_DB_PATH): void {
  const resolved = expandHome(dbPath);
  atomicWriteFileSync(resolved, JSON.stringify(store, null, 2));
}

export type ShaCheckResult =
  | { kind: "first-use"; record: PluginShaRecord }
  | { kind: "match"; record: PluginShaRecord }
  | { kind: "mismatch"; previousSha: string; currentSha: string; record: PluginShaRecord };

/**
 * Check a plugin file's SHA against the store. Does not mutate the
 * store — the caller decides whether to record / refuse.
 */
export function checkPluginSha(
  absPath: string,
  pluginId: string,
  store: PluginShaStore,
): ShaCheckResult {
  const sha = sha256OfFile(absPath);
  const existing = store.records[absPath];
  if (!existing) {
    return {
      kind: "first-use",
      record: {
        path: absPath,
        sha256: sha,
        pluginId,
        firstSeenAt: new Date().toISOString(),
      },
    };
  }
  if (existing.sha256 === sha) {
    return { kind: "match", record: existing };
  }
  return {
    kind: "mismatch",
    previousSha: existing.sha256,
    currentSha: sha,
    record: existing,
  };
}

/** Record (or update) a plugin's SHA in the store. */
export function recordPluginSha(absPath: string, pluginId: string, store: PluginShaStore): PluginShaRecord {
  const sha = sha256OfFile(absPath);
  const record: PluginShaRecord = {
    path: absPath,
    sha256: sha,
    pluginId,
    firstSeenAt: store.records[absPath]?.firstSeenAt ?? new Date().toISOString(),
  };
  store.records[absPath] = record;
  return record;
}
