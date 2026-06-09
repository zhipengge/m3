import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SnapshotStore } from "./snapshot-store.js";

let dir: string;
let store: SnapshotStore;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-snap-"));
  store = new SnapshotStore(dir);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("SnapshotStore", () => {
  it("save writes a single file and returns the record", () => {
    const rec = store.save("s1", 3, [{ role: "user", content: "x" }], "auto");
    expect(rec.turn).toBe(3);
    expect(rec.messageCount).toBe(1);
    expect(fs.readdirSync(path.join(dir, "s1")).length).toBe(1);
  });

  it("list returns snapshots oldest first", () => {
    store.save("s1", 1, ["a"]);
    store.save("s1", 5, ["b"]);
    store.save("s1", 3, ["c"]);
    const list = store.list("s1");
    expect(list.map((r) => r.turn)).toEqual([1, 3, 5]);
  });

  it("load returns the messages at a given turn", () => {
    store.save("s1", 7, [{ role: "user", content: "hello" }]);
    const msgs = store.load("s1", 7);
    expect(msgs).toEqual([{ role: "user", content: "hello" }]);
  });

  it("load returns null when the turn doesn't have a snapshot", () => {
    expect(store.load("s1", 99)).toBeNull();
  });

  it("list returns [] for an unknown session", () => {
    expect(store.list("missing")).toEqual([]);
  });

  it("gc keeps the most recent N auto snapshots", () => {
    for (let i = 1; i <= 10; i++) store.save("s1", i, [`m${i}`], "auto");
    const deleted = store.gc("s1", 3);
    expect(deleted).toBe(7);
    const turns = store.list("s1").map((r) => r.turn);
    expect(turns).toEqual([8, 9, 10]);
  });

  it("gc never deletes manual snapshots", () => {
    for (let i = 1; i <= 5; i++) store.save("s1", i, [`m${i}`], "auto");
    store.save("s1", 100, ["manual"], "manual");
    const deleted = store.gc("s1", 2);
    expect(deleted).toBe(3);
    const turns = store.list("s1").map((r) => r.turn);
    // Auto: keep last 2 (turns 4, 5). Manual: keep 100. Deleted: 1, 2, 3.
    expect(turns).toEqual([4, 5, 100]);
  });

  it("gc is a no-op when under the cap", () => {
    store.save("s1", 1, ["m"], "auto");
    store.save("s1", 2, ["m"], "auto");
    expect(store.gc("s1", 10)).toBe(0);
    expect(store.list("s1")).toHaveLength(2);
  });
});
