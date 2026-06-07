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
});
