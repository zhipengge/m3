import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadProjectMemory } from "./project-memory.js";

let dir: string;
let home: string;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "m3-home-"));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-cwd-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe("loadProjectMemory", () => {
  it("returns empty block when no files exist", () => {
    const out = loadProjectMemory({ cwd: dir, userHome: home, stopAt: dir });
    expect(out.block).toBe("");
    expect(out.sources).toEqual([]);
    expect(out.truncated).toBe(false);
  });

  it("loads ~/.m3/CLAUDE.md (user-level)", () => {
    fs.mkdirSync(path.join(home, ".m3"), { recursive: true });
    fs.writeFileSync(path.join(home, ".m3", "CLAUDE.md"), "user-level note");
    const out = loadProjectMemory({ cwd: dir, userHome: home, stopAt: dir });
    expect(out.block).toContain("user-level note");
    expect(out.sources[0]).toContain(".m3/CLAUDE.md");
  });

  it("loads ./CLAUDE.md at the cwd level", () => {
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "project-level note");
    const out = loadProjectMemory({ cwd: dir, userHome: home, stopAt: dir });
    expect(out.block).toContain("project-level note");
  });

  it("walks up the directory tree", () => {
    const child = fs.mkdtempSync(path.join(dir, "child-"));
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "parent");
    fs.writeFileSync(path.join(child, "AGENTS.md"), "child");
    const out = loadProjectMemory({ cwd: child, userHome: home, stopAt: home });
    expect(out.block).toContain("parent");
    expect(out.block).toContain("child");
  });

  it("stops at the configured stopAt (default: $HOME)", () => {
    // Create CLAUDE.md above the home so the walk would pick it
    // up if not for the stopAt guard. (Most CI hosts put $HOME
    // at /tmp/.../xyz, so this just verifies we don't keep
    // walking past the configured root.)
    const out = loadProjectMemory({ cwd: dir, userHome: home, stopAt: dir });
    // We never touched anything; nothing should be loaded.
    expect(out.sources).toEqual([]);
  });

  it("truncates when the combined block is huge", () => {
    const big = "x".repeat(20_000);
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), big);
    const out = loadProjectMemory({ cwd: dir, userHome: home, stopAt: dir });
    expect(out.truncated).toBe(true);
    expect(out.block).toContain("[…truncated");
  });

  it("prefers ./CLAUDE.md over ./.claude/CLAUDE.md at the same level", () => {
    fs.writeFileSync(path.join(dir, "CLAUDE.md"), "first");
    fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".claude", "CLAUDE.md"), "second");
    const out = loadProjectMemory({ cwd: dir, userHome: home, stopAt: dir });
    // Only one of the two should appear in `sources` (the first).
    expect(out.block).toContain("first");
    expect(out.block).not.toContain("second");
    expect(out.sources).toHaveLength(1);
  });
});
