import { describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "@m3/config";

vi.mock("../mcp/provider.js", () => ({
  mcpToolProvider: {
    id: "mcp",
    provide: async () => ({
      tools: [
        {
          name: "mcp__filesystem__write_file",
          description: "mcp write",
          inputSchema: { type: "object", properties: {} },
          needsPermission: true,
          execute: async () => ({ content: "ok" }),
        },
        {
          name: "mcp__filesystem__read_file",
          description: "mcp read",
          inputSchema: { type: "object", properties: {} },
          isReadOnly: true,
          execute: async () => ({ content: "ok" }),
        },
      ],
    }),
  },
}));

import { collectTools } from "./tool-source.js";

describe("collectTools", () => {
  it("drops MCP write_file when builtin Write is present", async () => {
    const config = {
      tools: "*",
      permissionMode: "default",
    } as AgentConfig;
    const { tools } = await collectTools(config);
    expect(tools.some((t) => t.name === "Write")).toBe(true);
    expect(tools.some((t) => t.name === "mcp__filesystem__write_file")).toBe(false);
    expect(tools.some((t) => t.name === "mcp__filesystem__read_file")).toBe(true);
  });
});
