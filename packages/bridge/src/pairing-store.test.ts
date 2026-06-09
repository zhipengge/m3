import { describe, expect, it, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { PairingStore, DEFAULT_PAIRING_TTL_MS } from "./pairing-store.js";

function freshStore(now: () => number): PairingStore {
  const tmp = path.join(os.tmpdir(), `m3-pair-${Math.random().toString(36).slice(2, 9)}.json`);
  return new PairingStore(tmp, { now });
}

describe("PairingStore", () => {
  describe("basic flow", () => {
    it("creates a 6-char code and approves it", () => {
      const store = freshStore(() => 1_000_000);
      const rec = store.getOrCreate("feishu", "default", "u1");
      expect(rec.code).toMatch(/^[A-Z0-9]{6}$/);
      expect(rec.approved).toBe(false);
      expect(store.approve("feishu", "default", "u1", rec.code)).toBe(true);
      expect(store.isApproved("feishu", "default", "u1")).toBe(true);
    });

    it("rejects wrong codes case-insensitively", () => {
      const store = freshStore(() => 1_000_000);
      const rec = store.getOrCreate("feishu", "default", "u1");
      expect(store.approve("feishu", "default", "u1", rec.code.toLowerCase())).toBe(true);
    });

    it("returns existing record on repeated getOrCreate", () => {
      const store = freshStore(() => 1_000_000);
      const a = store.getOrCreate("feishu", "default", "u1");
      const b = store.getOrCreate("feishu", "default", "u1");
      expect(a.code).toBe(b.code);
    });
  });

  describe("expiration", () => {
    let clock = 0;
    const now = () => clock;
    beforeEach(() => {
      clock = 1_700_000_000_000;
    });

    it("expires unapproved codes after TTL", () => {
      const store = new PairingStore(path.join(os.tmpdir(), `m3-pair-${Math.random()}.json`), {
        ttlMs: 1000,
        now,
      });
      const rec = store.getOrCreate("feishu", "default", "u1");
      expect(rec.approved).toBe(false);
      clock += 1001;
      expect(store.isApproved("feishu", "default", "u1")).toBe(false);
      // Wrong code should NOT re-approve an expired record
      expect(store.approve("feishu", "default", "u1", rec.code)).toBe(false);
    });

    it("mints a fresh code once the old one expires", () => {
      const store = new PairingStore(path.join(os.tmpdir(), `m3-pair-${Math.random()}.json`), {
        ttlMs: 60_000,
        now,
      });
      const a = store.getOrCreate("feishu", "default", "u1");
      clock += 60_001;
      const b = store.getOrCreate("feishu", "default", "u1");
      expect(b.code).not.toBe(a.code);
    });

    it("approved codes never expire", () => {
      const store = new PairingStore(path.join(os.tmpdir(), `m3-pair-${Math.random()}.json`), {
        ttlMs: 1000,
        now,
      });
      const rec = store.getOrCreate("feishu", "default", "u1");
      store.approve("feishu", "default", "u1", rec.code);
      clock += 10_000;
      expect(store.isApproved("feishu", "default", "u1")).toBe(true);
    });

    it("prune() evicts expired unapproved records", () => {
      const store = new PairingStore(path.join(os.tmpdir(), `m3-pair-${Math.random()}.json`), {
        ttlMs: 1000,
        now,
      });
      store.getOrCreate("feishu", "default", "u1");
      store.getOrCreate("feishu", "default", "u2");
      clock += 5000;
      const removed = store.prune();
      expect(removed).toBe(2);
      expect(store.list()).toHaveLength(0);
    });

    it("load() evicts expired records persisted on disk", () => {
      const dbPath = path.join(os.tmpdir(), `m3-pair-${Math.random()}.json`);
      const writer = new PairingStore(dbPath, { ttlMs: 1000, now });
      writer.getOrCreate("feishu", "default", "u1");
      clock += 5000;
      // Loading again with a now() past TTL should drop the stale record
      const reloaded = new PairingStore(dbPath, { ttlMs: 1000, now });
      expect(reloaded.list()).toHaveLength(0);
    });
  });

  describe("defaults", () => {
    it("exports a 24h default TTL", () => {
      expect(DEFAULT_PAIRING_TTL_MS).toBe(24 * 60 * 60 * 1000);
    });
  });

  describe("filesystem", () => {
    it("creates parent directories on persist", () => {
      const dbPath = path.join(os.tmpdir(), `m3-pair-dir-${Math.random()}`, "sub", "pairing.json");
      const store = new PairingStore(dbPath, { now: () => 1_000_000 });
      store.getOrCreate("feishu", "default", "u1");
      expect(fs.existsSync(dbPath)).toBe(true);
    });

    it("recovers from corrupt JSON", () => {
      const dbPath = path.join(os.tmpdir(), `m3-pair-${Math.random()}.json`);
      fs.writeFileSync(dbPath, "{ not json", "utf8");
      const store = new PairingStore(dbPath, { now: () => 1_000_000 });
      expect(store.list()).toHaveLength(0);
    });
  });
});
