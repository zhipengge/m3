import { describe, expect, it } from "vitest";
import { describeToolCall } from "./tool-description.js";

describe("describeToolCall", () => {
  it("describes Bash with the actual command", () => {
    expect(describeToolCall("Bash", { command: "pnpm test" })).toBe("Bash: pnpm test");
  });

  it("truncates long Bash commands", () => {
    const long = "echo " + "x".repeat(500);
    const out = describeToolCall("Bash", { command: long });
    expect(out.length).toBeLessThanOrEqual(210);
    expect(out.startsWith("Bash: echo xxx")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
  });

  it("falls back to a placeholder when Bash is missing the command", () => {
    expect(describeToolCall("Bash", {})).toBe("Bash: <no command>");
  });

  it("describes Read with file_path", () => {
    expect(describeToolCall("Read", { file_path: "/tmp/a.txt" })).toBe("Read: /tmp/a.txt");
  });

  it("also accepts 'path' for Read", () => {
    expect(describeToolCall("Read", { path: "/tmp/a.txt" })).toBe("Read: /tmp/a.txt");
  });

  it("describes Write / Edit with file_path", () => {
    expect(describeToolCall("Write", { file_path: "/tmp/a.txt" })).toBe("Write: /tmp/a.txt");
    expect(describeToolCall("Edit", { file_path: "/tmp/a.txt" })).toBe("Edit: /tmp/a.txt");
  });

  it("describes Grep / Glob with the pattern", () => {
    expect(describeToolCall("Grep", { pattern: "TODO" })).toBe("Grep: TODO");
    expect(describeToolCall("Glob", { glob_pattern: "**/*.ts" })).toBe("Glob: **/*.ts");
  });

  it("falls back to 'Execute X' for unknown tools", () => {
    expect(describeToolCall("CustomTool", {})).toBe("Execute CustomTool");
    expect(describeToolCall("CustomTool", { foo: "bar" })).toBe("Execute CustomTool");
  });

  it("ignores non-string input fields", () => {
    expect(describeToolCall("Bash", { command: 42 })).toBe("Bash: <no command>");
    expect(describeToolCall("Read", { file_path: null })).toBe("Read: <no path>");
  });
});
