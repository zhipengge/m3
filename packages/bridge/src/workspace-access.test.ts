import { describe, expect, it } from "vitest";
import { isFileMutationTool, isSameWorkspace } from "./workspace-access.js";

describe("workspace-access", () => {
  it("detects file mutation tools", () => {
    expect(isFileMutationTool("Write")).toBe(true);
    expect(isFileMutationTool("mcp__filesystem__write_file")).toBe(true);
    expect(isFileMutationTool("Read")).toBe(false);
    expect(isFileMutationTool("Bash")).toBe(false);
  });

  it("compares workspace paths", () => {
    expect(isSameWorkspace("/tmp/foo", "/tmp/foo/")).toBe(true);
  });
});
