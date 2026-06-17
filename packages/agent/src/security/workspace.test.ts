import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildSandboxedEnv,
  BASH_ENV_SECRET_BLOCKLIST,
  DEFAULT_SANDBOX,
  resolveWithinWorkspace,
  SandboxViolationError,
} from "./workspace.js";

describe("workspace sandbox", () => {
  const root = "/work/proj";

  it("resolves relative paths under the root", () => {
    expect(resolveWithinWorkspace(root, "src/a.ts", DEFAULT_SANDBOX)).toBe("/work/proj/src/a.ts");
  });

  it("rejects traversal escaping the root", () => {
    expect(() => resolveWithinWorkspace(root, "../../etc/passwd", DEFAULT_SANDBOX)).toThrow(
      SandboxViolationError,
    );
  });

  it("rejects absolute paths outside the root", () => {
    expect(() => resolveWithinWorkspace(root, "/etc/passwd", DEFAULT_SANDBOX)).toThrow(
      SandboxViolationError,
    );
  });

  it("allows outside reads only when policy permits", () => {
    const policy = { enabled: true, allowReadOutside: true };
    expect(resolveWithinWorkspace(root, "/etc/hosts", policy, { readOnly: true })).toBe(
      "/etc/hosts",
    );
    expect(() => resolveWithinWorkspace(root, "/etc/hosts", policy)).toThrow(SandboxViolationError);
  });

  it("disabled sandbox allows anything", () => {
    const policy = { enabled: false, allowReadOutside: false };
    expect(resolveWithinWorkspace(root, "/etc/passwd", policy)).toBe("/etc/passwd");
  });
});

describe("bash env allowlist", () => {
  it("keeps allowed vars and drops secrets", () => {
    const env = buildSandboxedEnv(
      { PATH: "/usr/bin", HOME: "/home/u", SECRET_API_KEY: "sk-leak", AWS_SECRET: "x" },
      [],
    );
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/u");
    expect(env.SECRET_API_KEY).toBeUndefined();
    expect(env.AWS_SECRET).toBeUndefined();
  });

  it("honors extra allowlist entries", () => {
    const env = buildSandboxedEnv({ MY_FLAG: "1", OTHER: "2" }, ["MY_FLAG"]);
    expect(env.MY_FLAG).toBe("1");
    expect(env.OTHER).toBeUndefined();
  });

  it("refuses to copy secret-looking names even when allowlisted", () => {
    const blocked: string[] = [];
    const env = buildSandboxedEnv(
      {
        M3_OPENAI_API_KEY: "sk-x",
        DEEPSEEK_TOKEN: "t",
        DB_PASSWORD: "p",
        APP_SECRET: "s",
        MY_FLAG: "1",
      },
      ["M3_OPENAI_API_KEY", "DEEPSEEK_TOKEN", "DB_PASSWORD", "APP_SECRET", "MY_FLAG"],
      { onBlocked: (n) => blocked.push(n) },
    );
    expect(env.M3_OPENAI_API_KEY).toBeUndefined();
    expect(env.DEEPSEEK_TOKEN).toBeUndefined();
    expect(env.DB_PASSWORD).toBeUndefined();
    expect(env.APP_SECRET).toBeUndefined();
    expect(env.MY_FLAG).toBe("1");
    expect(blocked.sort()).toEqual(
      ["APP_SECRET", "DB_PASSWORD", "DEEPSEEK_TOKEN", "M3_OPENAI_API_KEY"],
    );
  });

  it("blocklist pattern covers KEY/SECRET/TOKEN/PASSWORD/CREDENTIAL", () => {
    for (const name of [
      "OPENAI_API_KEY",
      "GITHUB_TOKEN",
      "DB_PASSWORD",
      "STRIPE_SECRET",
      "AWS_CREDENTIAL_FILE",
    ]) {
      expect(BASH_ENV_SECRET_BLOCKLIST.test(name)).toBe(true);
    }
    for (const safe of ["PATH", "HOME", "TZ", "MY_FLAG"]) {
      expect(BASH_ENV_SECRET_BLOCKLIST.test(safe)).toBe(false);
    }
  });
});

describe("workspace sandbox symlink hardening", () => {
  let tmpRoot: string;
  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "m3-sandbox-"));
    fs.mkdirSync(path.join(tmpRoot, "work"));
    fs.mkdirSync(path.join(tmpRoot, "outside"));
    fs.writeFileSync(path.join(tmpRoot, "outside", "secret.txt"), "x");
    // workspace/escape -> ../outside
    fs.symlinkSync(
      path.join(tmpRoot, "outside"),
      path.join(tmpRoot, "work", "escape"),
    );
    // workspace/inside -> ../work/legit (still inside workspace)
    fs.mkdirSync(path.join(tmpRoot, "work", "legit"));
    fs.symlinkSync(
      path.join(tmpRoot, "work", "legit"),
      path.join(tmpRoot, "work", "inside-link"),
    );
  });
  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("rejects writes through a symlink that escapes the workspace", () => {
    const root = path.join(tmpRoot, "work");
    expect(() =>
      resolveWithinWorkspace(root, "escape/secret.txt", DEFAULT_SANDBOX),
    ).toThrow(SandboxViolationError);
  });

  it("rejects new files created under a symlink that escapes", () => {
    const root = path.join(tmpRoot, "work");
    expect(() =>
      resolveWithinWorkspace(root, "escape/new.txt", DEFAULT_SANDBOX),
    ).toThrow(SandboxViolationError);
  });

  it("allows symlinks that stay inside the workspace", () => {
    const root = path.join(tmpRoot, "work");
    const resolved = resolveWithinWorkspace(
      root,
      "inside-link/file.txt",
      DEFAULT_SANDBOX,
    );
    expect(resolved.startsWith(root)).toBe(true);
  });
});
