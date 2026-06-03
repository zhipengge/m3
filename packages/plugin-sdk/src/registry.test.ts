import { describe, expect, it, beforeEach } from "vitest";
import type { ToolDefinition } from "@m3/agent";
import {
  clearPluginRegistry,
  listPluginTools,
  registerPluginTool,
} from "./registry.js";

describe("plugin registry", () => {
  beforeEach(() => {
    clearPluginRegistry();
  });

  it("registers tools for the plugin ToolProvider", () => {
    const tool: ToolDefinition = {
      name: "PluginPing",
      description: "ping",
      inputSchema: { type: "object", properties: {} },
      isReadOnly: true,
      execute: async () => ({ content: "pong" }),
    };
    registerPluginTool(tool);
    expect(listPluginTools()).toContain("PluginPing");
  });
});
