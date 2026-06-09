import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listWorkspaces,
  renameWorkspace,
  resolveWorkspace,
  resolveWorkspaceAbsPathSync,
  workspaceIdFor,
} from "./workspace-store.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-ws-"));
  // redirect HOME so the workspaces.json write lands in dir
  process.env.HOME = dir;
  fs.mkdirSync(path.join(dir, ".m3"), { recursive: true });
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("workspaceIdFor", () => {
  it("is deterministic for the same path", () => {
    expect(workspaceIdFor("/a/b/c")).toBe(workspaceIdFor("/a/b/c"));
  });

  it("differs for different paths", () => {
    expect(workspaceIdFor("/a/b/c")).not.toBe(workspaceIdFor("/a/b/d"));
  });

  it("uses the ws- prefix", () => {
    expect(workspaceIdFor("/foo")).toMatch(/^ws-[0-9a-f]{16}$/);
  });

  it("ignores trailing slashes / dot segments in identity", () => {
    // path.resolve normalizes `/foo/./` to `/foo` before the
    // hash, so different spellings of the same cwd produce
    // the same id. (realpath is NOT applied here — that's a
    // separate concern, see resolveWorkspace which uses
    // realpath to detect symlink-renamed workspaces.)
    expect(workspaceIdFor(dir)).toBe(workspaceIdFor(path.join(dir, ".")));
  });
});

describe("resolveWorkspace", () => {
  it("creates a new record on first call", () => {
    const rec = resolveWorkspace(dir);
    expect(rec.id).toMatch(/^ws-/);
    expect(rec.absPath).toBe(resolveWorkspaceAbsPathSync(dir));
    expect(rec.label).toBe(path.basename(dir));
    expect(rec.firstSeenAt).toMatch(/T.*Z/);
  });

  it("returns the same record on second call (stable id)", () => {
    const a = resolveWorkspace(dir);
    const b = resolveWorkspace(dir);
    expect(a.id).toBe(b.id);
    expect(a.absPath).toBe(b.absPath);
  });

  it("different cwds get different ids", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "m3-ws2-"));
    try {
      const a = resolveWorkspace(dir);
      const b = resolveWorkspace(other);
      expect(a.id).not.toBe(b.id);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it("renames the label without changing the id", () => {
    const rec = resolveWorkspace(dir);
    const renamed = renameWorkspace(rec.absPath, "My Cool Project");
    expect(renamed?.label).toBe("My Cool Project");
    expect(renamed?.id).toBe(rec.id);
  });

  it("list returns all known workspaces", () => {
    const a = resolveWorkspace(dir);
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "m3-ws3-"));
    try {
      const b = resolveWorkspace(other);
      const list = listWorkspaces();
      expect(list.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});
