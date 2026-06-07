import fs from "node:fs";
import { atomicWriteFileSync } from "./fs-utils.js";
import { expandHome } from "./schema.js";

const DEFAULT_PATH = "~/.m3/last-model.json";

export type LastModelRecord = {
  /** Last user-requested model ref. */
  model: string;
  /** ISO timestamp of the last write. */
  updatedAt: string;
};

/** Load the last-model record; returns null when no file / corrupt. */
export function loadLastModel(path: string = DEFAULT_PATH): LastModelRecord | null {
  const resolved = expandHome(path);
  if (!fs.existsSync(resolved)) return null;
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf8")) as LastModelRecord;
  } catch {
    return null;
  }
}

/** Atomically persist at 0o600 (consistent with the other ~/.m3/ files). */
export function saveLastModel(model: string, path: string = DEFAULT_PATH): LastModelRecord {
  const record: LastModelRecord = {
    model,
    updatedAt: new Date().toISOString(),
  };
  atomicWriteFileSync(expandHome(path), JSON.stringify(record, null, 2));
  return record;
}
