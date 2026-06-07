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

import { applyToolAllowlist, collectTools } from "./tool-source.js";

describe("applyToolAllowlist", () => {
  const t = (name: string) => ({
    name,
    description: name,
    inputSchema: { type: "object" as const, properties: {} },
    execute: async () => ({ content: "ok" }),
  });
  const tools = [t("Read"), t("Write"), t("Bash")];

  it("returns input unchanged when allowlist is \"*\"", () => {
    expect(applyToolAllowlist(tools, "*").map((x) => x.name)).toEqual([
      "Read",
      "Write",
      "Bash",
    ]);
  });

  it("returns input unchanged when allowlist is undefined", () => {
    expect(applyToolAllowlist(tools, undefined).length).toBe(3);
  });

  it("keeps only listed names when allowlist is an array", () => {
    expect(applyToolAllowlist(tools, ["Read"]).map((x) => x.name)).toEqual(["Read"]);
  });

  it("keeps nothing when allowlist is empty", () => {
    expect(applyToolAllowlist(tools, []).length).toBe(0);
  });
});

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

  it("enforces agent.tools allowlist: hides unlisted tools", async () => {
    const config = {
      tools: ["Read", "mcp__filesystem__read_file"],
      permissionMode: "default",
    } as AgentConfig;
    const { tools } = await collectTools(config);
    const names = tools.map((t) => t.name);
    expect(names).toContain("Read");
    expect(names).toContain("mcp__filesystem__read_file");
    expect(names).not.toContain("Write");
    expect(names).not.toContain("Bash");
    expect(names).not.toContain("mcp__filesystem__write_file");
  });
});
