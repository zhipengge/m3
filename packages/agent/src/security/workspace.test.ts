import { describe, expect, it } from "vitest";
import {
  buildSandboxedEnv,
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
});
