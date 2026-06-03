import type { AgentConfig } from "@m3/config";
import type { ToolDefinition } from "../harness/types.js";
import { bashTool } from "./bash-tool.js";
import { editTool, readTool, writeTool } from "./file-tools.js";
import { globTool, grepTool } from "./search-tools.js";

const ALL_TOOLS: ToolDefinition[] = [readTool, writeTool, editTool, bashTool, globTool, grepTool];

export function getAllTools(): ToolDefinition[] {
  return ALL_TOOLS;
}

export function getTools(config: Pick<AgentConfig, "tools" | "permissionMode">): ToolDefinition[] {
  let tools = ALL_TOOLS;
  if (config.tools !== "*") {
    const allowed = new Set(config.tools);
    tools = tools.filter((t) => allowed.has(t.name));
  }
  if (config.permissionMode === "plan") {
    tools = tools.filter((t) => t.isReadOnly);
  }
  return tools;
}

export function findToolByName(tools: ToolDefinition[], name: string): ToolDefinition | undefined {
  return tools.find((t) => t.name === name);
}
