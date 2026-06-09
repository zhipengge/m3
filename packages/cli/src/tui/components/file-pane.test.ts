import { describe, expect, it } from "vitest";
import { filePathForTool } from "./file-pane.js";

describe("filePathForTool", () => {
  it("extracts file_path for Read", () => {
    expect(filePathForTool("Read", { file_path: "/tmp/a.ts" })).toBe("/tmp/a.ts");
  });

  it("extracts file_path for Edit", () => {
    expect(
      filePathForTool("Edit", { file_path: "/tmp/a.ts", old_string: "x", new_string: "y" }),
    ).toBe("/tmp/a.ts");
  });

  it("extracts file_path for Write", () => {
    expect(filePathForTool("Write", { file_path: "/tmp/a.ts", content: "..." })).toBe(
      "/tmp/a.ts",
    );
  });

  it("falls back to the path key when file_path is missing", () => {
    expect(filePathForTool("Read", { path: "/tmp/b.ts" })).toBe("/tmp/b.ts");
  });

  it("returns null for non-file tools (Bash, Grep, Glob, …)", () => {
    expect(filePathForTool("Bash", { command: "ls" })).toBeNull();
    expect(filePathForTool("Grep", { pattern: "x" })).toBeNull();
    expect(filePathForTool("Glob", { pattern: "*.ts" })).toBeNull();
  });

  it("returns null when the input is not an object", () => {
    expect(filePathForTool("Read", null)).toBeNull();
    expect(filePathForTool("Read", "string")).toBeNull();
    expect(filePathForTool("Read", 42)).toBeNull();
  });

  it("returns null when the path field is missing or empty", () => {
    expect(filePathForTool("Read", {})).toBeNull();
    expect(filePathForTool("Read", { file_path: "" })).toBeNull();
    expect(filePathForTool("Read", { file_path: 42 })).toBeNull();
  });
});
