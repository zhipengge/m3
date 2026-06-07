import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkPluginSha,
  loadPluginShaStore,
  recordPluginSha,
  savePluginShaStore,
  sha256OfFile,
  type PluginShaStore,
} from "./plugin-shas.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-plugin-shas-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writePlugin(content: string): string {
  const p = path.join(dir, "plugin.mjs");
  fs.writeFileSync(p, content);
  return p;
}

describe("sha256OfFile", () => {
  it("hashes a file's contents", () => {
    const p = writePlugin("export default { id: 'x' }");
    const sha = sha256OfFile(p);
    expect(sha).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("loadPluginShaStore / savePluginShaStore", () => {
  it("returns empty store when file doesn't exist", () => {
    const store = loadPluginShaStore(path.join(dir, "missing.json"));
    expect(store.records).toEqual({});
  });

  it("round-trips through save → load", () => {
    const p = path.join(dir, "shas.json");
    const original: PluginShaStore = {
      records: { "/x": { path: "/x", sha256: "abc", pluginId: "x", firstSeenAt: "t" } },
    };
    savePluginShaStore(original, p);
    const loaded = loadPluginShaStore(p);
    expect(loaded.records["/x"]?.sha256).toBe("abc");
  });

  it("returns empty store on corrupt JSON (logs to stderr)", () => {
    const p = path.join(dir, "shas.json");
    fs.writeFileSync(p, "{not json");
    const store = loadPluginShaStore(p);
    expect(store.records).toEqual({});
  });
});

describe("checkPluginSha", () => {
  it("returns first-use for a new file", () => {
    const p = writePlugin("export default { id: 'x' }");
    const store: PluginShaStore = { records: {} };
    const result = checkPluginSha(p, "x", store);
    expect(result.kind).toBe("first-use");
  });

  it("returns match when SHA is unchanged", () => {
    const p = writePlugin("export default { id: 'x' }");
    let store: PluginShaStore = { records: {} };
    recordPluginSha(p, "x", store);
    const result = checkPluginSha(p, "x", store);
    expect(result.kind).toBe("match");
  });

  it("returns mismatch when the file has been modified", () => {
    const p = writePlugin("export default { id: 'x' }");
    const store: PluginShaStore = { records: {} };
    recordPluginSha(p, "x", store);
    fs.writeFileSync(p, "export default { id: 'evil' }");
    const result = checkPluginSha(p, "x", store);
    expect(result.kind).toBe("mismatch");
    if (result.kind === "mismatch") {
      expect(result.previousSha).not.toBe(result.currentSha);
    }
  });
});
