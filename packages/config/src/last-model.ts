import fs from "node:fs";
import { atomicWriteFileSync } from "./fs-utils.js";
import { expandHome } from "./schema.js";

/**
 * D4: per-workspace last-model file. Previously a single
 * \`~/.m3/last-model.json\` was global, so switching cwd would
 * carry the new model choice to unrelated projects. Now keyed
 * by workspace id (\`ws-<16hex>\`) so the choice is scoped.
 *
 * The legacy \`~/.m3/last-model.json\` file (single, global) is
 * still readable for backwards compatibility but new writes
 * always go to the ws-id file. A migration helper is exposed
 * (\`migrateLegacyLastModel\`) for the CLI to call once per
 * machine.
 */
const LEGACY_PATH = "~/.m3/last-model.json";
const WS_PATH_PREFIX = "~/.m3/last-model.";

export type LastModelRecord = {
  /** Last user-requested model ref. */
  model: string;
  /** ISO timestamp of the last write. */
  updatedAt: string;
  /** Workspace id this record belongs to (D4). */
  workspaceId?: string;
};

/** Build the per-workspace path from a workspace id. */
export function lastModelPathFor(workspaceId: string): string {
  return `${WS_PATH_PREFIX}${workspaceId}.json`;
}

/** Load the last-model record for a workspace. Falls back to
 *  the legacy global file when no per-workspace record exists
 *  AND the caller passes the same workspaceId (i.e. the
 *  fallback is "I haven't recorded anything for this project
 *  yet, but the global is a reasonable starting point"). */
export function loadLastModel(workspaceId?: string): LastModelRecord | null {
  if (workspaceId) {
    const fp = expandHome(lastModelPathFor(workspaceId));
    if (fs.existsSync(fp)) {
      try {
        return JSON.parse(fs.readFileSync(fp, "utf8")) as LastModelRecord;
      } catch {
        return null;
      }
    }
  }
  // Legacy global fallback.
  const legacy = expandHome(LEGACY_PATH);
  if (!fs.existsSync(legacy)) return null;
  try {
    return JSON.parse(fs.readFileSync(legacy, "utf8")) as LastModelRecord;
  } catch {
    return null;
  }
}

/** Atomically persist at 0o600 (consistent with the other ~/.m3/ files). */
export function saveLastModel(
  model: string,
  workspaceId: string = "default",
): LastModelRecord {
  const record: LastModelRecord = {
    model,
    updatedAt: new Date().toISOString(),
    workspaceId,
  };
  atomicWriteFileSync(expandHome(lastModelPathFor(workspaceId)), JSON.stringify(record, null, 2));
  return record;
}

/** One-time migration: rename the legacy global file to a
 *  ws-id file if the latter doesn't exist. Returns the
 *  workspaceId the file was renamed under, or null when
 *  nothing was migrated. */
export function migrateLegacyLastModel(workspaceId: string): string | null {
  const legacy = expandHome(LEGACY_PATH);
  const target = expandHome(lastModelPathFor(workspaceId));
  if (!fs.existsSync(legacy) || fs.existsSync(target)) return null;
  fs.renameSync(legacy, target);
  return workspaceId;
}
