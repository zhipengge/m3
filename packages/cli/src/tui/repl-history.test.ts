import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHistoryStore } from "./repl-history.js";

function tmpFile(): string {
  return path.join(os.tmpdir(), `m3-history-${Math.random().toString(36).slice(2, 9)}.txt`);
}

describe("createHistoryStore", () => {
  let filePath: string;
  beforeEach(() => {
    filePath = tmpFile();
  });
  afterEach(() => {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* ok */
    }
  });

  it("starts empty when the file is missing", () => {
    const store = createHistoryStore(filePath);
    expect(store.recent(10)).toEqual([]);
  });

  it("appends and reads back", () => {
    const store = createHistoryStore(filePath);
    store.push("first");
    store.push("second");
    expect(store.recent(10)).toEqual(["second", "first"]);
  });

  it("deduplicates adjacent duplicates", () => {
    const store = createHistoryStore(filePath);
    store.push("a");
    store.push("a");
    store.push("a");
    expect(store.recent(10)).toEqual(["a"]);
  });

  it("ignores blank lines", () => {
    const store = createHistoryStore(filePath);
    store.push("");
    store.push("   ");
    expect(store.recent(10)).toEqual([]);
  });

  it("persists across instances", () => {
    const a = createHistoryStore(filePath);
    a.push("alpha");
    a.push("beta");
    a.flush();

    const b = createHistoryStore(filePath);
    expect(b.recent(10)).toEqual(["beta", "alpha"]);
  });

  it("caps at MAX_ENTRIES (200)", () => {
    const store = createHistoryStore(filePath);
    for (let i = 0; i < 250; i++) store.push(`cmd-${i}`);
    expect(store.recent(1000)).toHaveLength(200);
    // Newest is cmd-249, oldest kept is cmd-50.
    expect(store.recent(200)[0]).toBe("cmd-249");
    expect(store.recent(200)[199]).toBe("cmd-50");
  });

  it("clamps recent() to available entries", () => {
    const store = createHistoryStore(filePath);
    store.push("only");
    expect(store.recent(5)).toEqual(["only"]);
  });

  it("swallows IO errors (best-effort persistence)", () => {
    // Point at a directory that doesn't exist and can't be created.
    const store = createHistoryStore("/dev/null/cannot/create/here");
    store.push("x");
    expect(() => store.flush()).not.toThrow();
  });
});
