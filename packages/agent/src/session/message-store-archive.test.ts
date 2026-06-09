import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SessionMessageStore } from "./message-store.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let dir: string;
let store: SessionMessageStore;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-archive-"));
  store = new SessionMessageStore(dir);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("SessionMessageStore.archive + restoreLatestArchive", () => {
  it("archive moves the file to _archive/<ts>-<sid>.json", () => {
    store.save("s1", [{ role: "user", content: "hi" }]);
    const archivePath = store.archive("s1");
    expect(archivePath).not.toBeNull();
    expect(archivePath!).toContain("_archive");
    expect(fs.existsSync(path.join(dir, "s1.json"))).toBe(false);
    expect(fs.existsSync(archivePath!)).toBe(true);
  });

  it("archive returns null when no transcript exists", () => {
    expect(store.archive("missing")).toBeNull();
  });

  it("restoreLatestArchive brings the latest archive back", async () => {
    store.save("s1", [{ role: "user", content: "v1" }]);
    const a1 = store.archive("s1")!;
    // Re-create a fresh transcript, then archive again. Sleep a
    // millisecond so the two `Date.now()`-suffixed filenames differ
    // (archive paths are sorted lexically by name; equal timestamps
    // would make "the most recent" ambiguous).
    await sleep(2);
    store.save("s1", [{ role: "user", content: "v2" }]);
    const a2 = store.archive("s1")!;
    expect(a1).not.toBe(a2);

    // Restore — should pull the most recent (a2).
    expect(store.restoreLatestArchive("s1")).toBe("s1");
    const reloaded = store.load("s1");
    expect(reloaded[0]?.content).toBe("v2");
  });

  it("restoreLatestArchive is a no-op if the live transcript already exists", () => {
    store.save("s1", [{ role: "user", content: "live" }]);
    store.archive("s1");
    store.save("s1", [{ role: "user", content: "resumed" }]);
    // A second archive so there's something to restore.
    store.archive("s1");
    store.save("s1", [{ role: "user", content: "current" }]);

    // Live file present → restore refuses to clobber.
    expect(store.restoreLatestArchive("s1")).toBeNull();
    expect(store.load("s1")[0]?.content).toBe("current");
  });

  it("restoreLatestArchive returns null when no archive exists", () => {
    expect(store.restoreLatestArchive("nothing")).toBeNull();
  });

  it("clear() still works (legacy hard-delete path)", () => {
    store.save("s1", [{ role: "user", content: "x" }]);
    store.clear("s1");
    expect(fs.existsSync(path.join(dir, "s1.json"))).toBe(false);
  });
});
