import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWriteFileSync, SECRET_FILE_MODE } from "./fs-utils.js";

describe("atomicWriteFileSync", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "m3-fsutils-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes the file at the requested path", () => {
    const fp = path.join(dir, "a.json");
    atomicWriteFileSync(fp, '{"hello":"world"}');
    expect(fs.readFileSync(fp, "utf8")).toBe('{"hello":"world"}');
  });

  it("sets the file to 0o600 on POSIX", () => {
    if (process.platform === "win32") return;
    const fp = path.join(dir, "secret.json");
    atomicWriteFileSync(fp, "{}");
    const stat = fs.statSync(fp);
    // Mask to the permission bits (last 9 of the mode word).
    expect(stat.mode & 0o777).toBe(SECRET_FILE_MODE);
  });

  it("creates intermediate directories", () => {
    const fp = path.join(dir, "deep", "nested", "x.json");
    atomicWriteFileSync(fp, "ok");
    expect(fs.existsSync(fp)).toBe(true);
  });

  it("overwrites an existing file atomically (no tmp left behind)", () => {
    const fp = path.join(dir, "x.json");
    atomicWriteFileSync(fp, "v1");
    atomicWriteFileSync(fp, "v2");
    expect(fs.readFileSync(fp, "utf8")).toBe("v2");
    const stragglers = fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".tmp"));
    expect(stragglers).toEqual([]);
  });

  it("accepts a custom mode override", () => {
    if (process.platform === "win32") return;
    const fp = path.join(dir, "loose.json");
    atomicWriteFileSync(fp, "{}", { mode: 0o644 });
    const stat = fs.statSync(fp);
    expect(stat.mode & 0o777).toBe(0o644);
  });
});
