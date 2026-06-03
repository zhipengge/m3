import { describe, expect, it } from "vitest";
import { getTools, getAllTools, findToolByName } from "./registry.js";

describe("tool registry", () => {
  it("includes core coding tools", () => {
    const names = getAllTools().map((t) => t.name);
    expect(names).toContain("Read");
    expect(names).toContain("Bash");
    expect(names).toContain("Glob");
  });

  it("filters tools by config", () => {
    const tools = getTools({ tools: ["Read", "Grep"], permissionMode: "default" });
    expect(tools).toHaveLength(2);
  });

  it("plan mode keeps read-only tools", () => {
    const tools = getTools({ tools: "*", permissionMode: "plan" });
    expect(tools.every((t) => t.isReadOnly)).toBe(true);
    expect(findToolByName(tools, "Bash")).toBeUndefined();
  });
});
