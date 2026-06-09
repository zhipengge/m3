import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { atomicWriteFileSync } from "./fs-utils.js";
import { expandHome } from "./schema.js";

/**
 * Workspace identity.
 *
 * Every m3 session is bound to a *workspace* — the absolute
 * path of the directory it was launched in. The workspace id
 * (`ws-<16hex>`) is a SHA-256 prefix of the resolved path,
 * stable across runs from the same cwd, distinct across
 * unrelated directories.
 *
 * Why not `path.basename(cwd)`? Because two unrelated projects
 * both named "src" or "app" or "server" would collide, and
 * session storage (memory, last-model, etc.) would leak
 * between them. The full absolute path is the only thing
 * that's globally unique for a given host.
 *
 * The mapping `cwd → ws-id` lives at `~/.m3/workspaces.json`
 * so the user can list / rename / inspect workspaces without
 * a sha lookup. Atomic 0o600 writes (consistent with the
 * other ~/.m3/ files).
 */

const WORKSPACES_PATH = "~/.m3/workspaces.json";

export type WorkspaceRecord = {
  /** Stable SHA-derived id (`ws-<16hex>`). */
  id: string;
  /** Absolute, symlink-resolved cwd. */
  absPath: string;
  /** User-set label (defaults to the last path segment). */
  label: string;
  /** ISO timestamp of first m3 launch in this workspace. */
  firstSeenAt: string;
  /** ISO timestamp of most recent launch. */
  lastSeenAt: string;
};

export type WorkspaceStore = {
  workspaces: Record<string, WorkspaceRecord>;
};

function pathId(absPath: string): string {
  const h = createHash("sha256").update(absPath).digest("hex").slice(0, 16);
  return `ws-${h}`;
}

/**
 * Resolve a cwd to a stable id, normalizing the path first
 * (`realpath`-style resolution: collapses `..`, resolves
 * symlinks, normalizes slashes). On platforms without
 * `realpath.native`, falls back to `path.resolve`.
 */
export async function resolveWorkspaceAbsPath(cwd: string): Promise<string> {
  // Try the native realpath (handles symlinks + case-insensitive
  // volumes on macOS). Fallback: path.resolve.
  try {
    const { realpath } = await import("node:fs/promises");
    return await realpath(cwd);
  } catch {
    return path.resolve(cwd);
  }
}

/** Synchronous variant for callers without async. */
export function resolveWorkspaceAbsPathSync(cwd: string): string {
  try {
    return fs.realpathSync(cwd);
  } catch {
    return path.resolve(cwd);
  }
}

/** Compute the id for an absolute path. Normalizes the path
 *  first (`..`, trailing slashes, mixed separators) so two
 *  spellings of the same cwd hash to the same id. */
export function workspaceIdFor(absPath: string): string {
  return pathId(path.resolve(absPath));
}

/** Load the workspaces index; returns an empty store on miss. */
export function loadWorkspaceStore(): WorkspaceStore {
  const fp = expandHome(WORKSPACES_PATH);
  if (!fs.existsSync(fp)) return { workspaces: {} };
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8")) as WorkspaceStore;
  } catch {
    return { workspaces: {} };
  }
}

function saveWorkspaceStore(store: WorkspaceStore): void {
  atomicWriteFileSync(expandHome(WORKSPACES_PATH), JSON.stringify(store, null, 2));
}

/**
 * Resolve the workspace for the current process. If the cwd
 * isn't in the store yet, it's added (with a default label
 * of the last path segment). Updates `lastSeenAt` on every
 * call. The whole operation is a single read-modify-write;
 * for the volumes m3 handles (one launch per user per
 * machine) the contention is negligible.
 */
export function resolveWorkspace(cwd?: string): WorkspaceRecord {
  const abs = cwd ? resolveWorkspaceAbsPathSync(cwd) : resolveWorkspaceAbsPathSync(process.cwd());
  const id = pathId(abs);
  const store = loadWorkspaceStore();
  const existing = store.workspaces[abs];
  const now = new Date().toISOString();
  if (existing) {
    if (existing.id !== id) {
      // Path moved? Realpath gave a different answer than last
      // time. Keep the new id but preserve the user-set label
      // and firstSeenAt.
      const updated = { ...existing, id, absPath: abs, lastSeenAt: now };
      store.workspaces[abs] = updated;
      saveWorkspaceStore(store);
      return updated;
    }
    if (existing.lastSeenAt !== now) {
      const updated = { ...existing, lastSeenAt: now };
      store.workspaces[abs] = updated;
      saveWorkspaceStore(store);
      return updated;
    }
    return existing;
  }
  const record: WorkspaceRecord = {
    id,
    absPath: abs,
    label: path.basename(abs) || abs,
    firstSeenAt: now,
    lastSeenAt: now,
  };
  store.workspaces[abs] = record;
  saveWorkspaceStore(store);
  return record;
}

/** Rename a workspace (label only — the id and path are immutable). */
export function renameWorkspace(absPath: string, newLabel: string): WorkspaceRecord | null {
  const store = loadWorkspaceStore();
  const existing = store.workspaces[absPath];
  if (!existing) return null;
  const updated: WorkspaceRecord = { ...existing, label: newLabel };
  store.workspaces[absPath] = updated;
  saveWorkspaceStore(store);
  return updated;
}

/** List all known workspaces, newest first. */
export function listWorkspaces(): WorkspaceRecord[] {
  const store = loadWorkspaceStore();
  return Object.values(store.workspaces).sort((a, b) =>
    b.lastSeenAt.localeCompare(a.lastSeenAt),
  );
}
