import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionMapper } from "./session-mapper.js";

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-session-mapper-"));
  dbPath = path.join(tmpDir, "sessions.json");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("SessionMapper debounce", () => {
  it("coalesces a burst of writes into a single disk write", async () => {
    const m = new SessionMapper(dbPath);
    m.upsert({
      sessionKey: "s1",
      agentId: "default",
      channel: "webchat",
      accountId: "default",
      peerId: "p1",
      updatedAt: new Date().toISOString(),
    });
    m.upsert({
      sessionKey: "s2",
      agentId: "default",
      channel: "webchat",
      accountId: "default",
      peerId: "p2",
      updatedAt: new Date().toISOString(),
    });
    // Right after the burst the file is not yet written.
    expect(fs.existsSync(dbPath)).toBe(false);
    // Wait past the debounce window.
    await new Promise((r) => setTimeout(r, 700));
    expect(fs.existsSync(dbPath)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    expect(Object.keys(onDisk.mappings)).toEqual(expect.arrayContaining(["s1", "s2"]));
  });

  it("flush() forces a write even when the debounce timer is pending", () => {
    const m = new SessionMapper(dbPath);
    m.upsert({
      sessionKey: "s1",
      agentId: "default",
      channel: "webchat",
      accountId: "default",
      peerId: "p1",
      updatedAt: new Date().toISOString(),
    });
    expect(fs.existsSync(dbPath)).toBe(false);
    m.flush();
    expect(fs.existsSync(dbPath)).toBe(true);
  });

  it("flush() is a no-op when nothing is dirty", () => {
    const m = new SessionMapper(dbPath);
    m.flush();
    expect(fs.existsSync(dbPath)).toBe(false);
  });
});
