import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadSecrets,
  looksLikePlaceholderKey,
  SecretsParseError,
} from "./secrets.js";

describe("loadSecrets", () => {
  let tmp: string;
  let file: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "m3-secrets-"));
    file = path.join(tmp, "secrets.json");
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns empty defaults when the file does not exist", () => {
    const secrets = loadSecrets(file);
    expect(secrets.providers).toEqual({});
  });

  it("loads valid secrets", () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ providers: { deepseek: { apiKey: "sk-real-key-1234567890" } } }),
    );
    const secrets = loadSecrets(file);
    expect(secrets.providers.deepseek?.apiKey).toBe("sk-real-key-1234567890");
  });

  it("throws SecretsParseError on invalid JSON (no longer silent)", () => {
    fs.writeFileSync(file, "{ not valid json");
    expect(() => loadSecrets(file)).toThrow(SecretsParseError);
  });

  it("tolerates invalid JSON when tolerant=true", () => {
    fs.writeFileSync(file, "{ not valid json");
    const secrets = loadSecrets(file, { tolerant: true });
    expect(secrets.providers).toEqual({});
  });

  it("warns when secrets file has loose permissions", () => {
    if (process.platform === "win32") return;
    fs.writeFileSync(file, JSON.stringify({ providers: {} }));
    fs.chmodSync(file, 0o644);
    const warnings: string[] = [];
    loadSecrets(file, { onWarning: (m) => warnings.push(m) });
    expect(warnings.some((w) => w.includes("permissions"))).toBe(true);
  });

  it("does not warn for 0600 files", () => {
    if (process.platform === "win32") return;
    fs.writeFileSync(file, JSON.stringify({ providers: {} }));
    fs.chmodSync(file, 0o600);
    const warnings: string[] = [];
    loadSecrets(file, { onWarning: (m) => warnings.push(m) });
    expect(warnings).toEqual([]);
  });
});

describe("looksLikePlaceholderKey", () => {
  it("flags empty / very short keys", () => {
    expect(looksLikePlaceholderKey("")).toBe(true);
    expect(looksLikePlaceholderKey(undefined)).toBe(false);
    expect(looksLikePlaceholderKey(null)).toBe(false);
    expect(looksLikePlaceholderKey("short")).toBe(true);
  });

  it("flags template patterns from m3 init / install.sh", () => {
    expect(looksLikePlaceholderKey("sk-your-deepseek-key")).toBe(true);
    expect(looksLikePlaceholderKey("sk-ant-your-key")).toBe(true);
    expect(looksLikePlaceholderKey("sk-example-1234567890")).toBe(true);
    expect(looksLikePlaceholderKey("changeme")).toBe(true);
    expect(looksLikePlaceholderKey("placeholder")).toBe(true);
  });

  it("passes realistic keys", () => {
    expect(looksLikePlaceholderKey("sk-1a2b3c4d5e6f7g8h9i0j")).toBe(false);
    expect(looksLikePlaceholderKey("xoxb-abcdefghijklmnop")).toBe(false);
    expect(
      looksLikePlaceholderKey(
        "sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ),
    ).toBe(false);
  });
});
