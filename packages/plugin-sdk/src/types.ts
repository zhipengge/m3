import type { ToolDefinition } from "@m3/agent";
import type { ChannelPlugin } from "@m3/channels";
import type { CommandHandler } from "@m3/commands";

export type M3PluginApi = {
  registerChannel: (plugin: ChannelPlugin) => void;
  registerTool: (tool: ToolDefinition) => void;
  registerCommand: (name: string, handler: CommandHandler) => void;
  log: (msg: string) => void;
};

export type M3Plugin = {
  id: string;
  register: (api: M3PluginApi) => void;
};
