import { describe, expect, it } from "vitest";
import { partitionToolCalls } from "./tool-orchestration.js";
import { getAllTools } from "../tools/registry.js";

describe("tool orchestration", () => {
  it("partitions concurrent read-only batches", () => {
    const tools = getAllTools();
    const batches = partitionToolCalls(
      [
        { type: "tool_use", id: "1", name: "Read", input: {} },
        { type: "tool_use", id: "2", name: "Glob", input: {} },
        { type: "tool_use", id: "3", name: "Bash", input: {} },
      ],
      tools,
    );
    expect(batches).toHaveLength(2);
    expect(batches[0]?.concurrent).toBe(true);
    expect(batches[0]?.blocks).toHaveLength(2);
    expect(batches[1]?.concurrent).toBe(false);
  });
});
