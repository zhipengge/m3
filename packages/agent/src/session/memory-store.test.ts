import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MemoryStore } from "./memory-store.js";

let dir: string;
let store: MemoryStore;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-memory-"));
  store = new MemoryStore(dir);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("MemoryStore", () => {
  it("appends a timestamped entry", () => {
    store.append("proj", "use pnpm, not npm");
    const fp = path.join(dir, "proj.md");
    const content = fs.readFileSync(fp, "utf8");
    expect(content).toContain("## ");
    expect(content).toContain("use pnpm, not npm");
    expect(content).toMatch(/T.*Z/);
  });

  it("appends multiple entries with increasing timestamps", () => {
    store.append("proj", "first");
    store.append("proj", "second");
    const content = fs.readFileSync(path.join(dir, "proj.md"), "utf8");
    expect(content.indexOf("first")).toBeLessThan(content.indexOf("second"));
  });

  it("readAll returns the full file when small", () => {
    store.append("proj", "tiny note");
    expect(store.readAll("proj")).toContain("tiny note");
  });

  it("readAll truncates the head when the file is too large", () => {
    const big = "x".repeat(2_000);
    store.append("proj", big);
    const out = store.readAll("proj", 500);
    expect(out).toContain("[…earlier notes truncated…]");
    // The output is bounded by maxBytes plus the marker.
    expect(out.length).toBeLessThan(500 + 100);
  });

  it("search returns lines with surrounding context", () => {
    store.append("proj", "alpha\nbeta\ngamma");
    const hits = store.search("proj", "beta");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toContain("beta");
  });

  it("search is case-insensitive", () => {
    store.append("proj", "Use Pnpm");
    expect(store.search("proj", "pnpm")).toHaveLength(1);
  });

  it("overwrite replaces content atomically", () => {
    store.append("proj", "old");
    store.overwrite("proj", "fresh content");
    const content = fs.readFileSync(path.join(dir, "proj.md"), "utf8");
    expect(content).toBe("fresh content");
  });

  it("listProjects returns every .md file in the memory dir", () => {
    store.append("alpha", "a");
    store.append("beta", "b");
    const projects = store.listProjects();
    expect(projects).toContain("alpha");
    expect(projects).toContain("beta");
  });
});
