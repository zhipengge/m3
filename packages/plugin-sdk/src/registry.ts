import type { ToolDefinition } from "@m3/agent";
import { registerToolProvider, type ToolProvider } from "@m3/agent";
import type { ChannelPlugin } from "@m3/channels";
import { registerChannel } from "@m3/channels";
import type { CommandHandler } from "@m3/commands";
import { registerCommand } from "@m3/commands";
import type { M3Plugin, M3PluginApi } from "./types.js";

const installedPlugins: M3Plugin[] = [];

const pluginTools = new Map<string, ToolDefinition>();
const pluginCommands = new Map<string, CommandHandler>();

const pluginToolProvider: ToolProvider = {
  id: "plugins",
  provide: async () => ({
    tools: [...pluginTools.values()],
  }),
};

let providerRegistered = false;

function ensureToolProvider(): void {
  if (providerRegistered) return;
  registerToolProvider(pluginToolProvider);
  providerRegistered = true;
}

/** Register a tool contributed by an m3 plugin (unique name per plugin recommended). */
export function registerPluginTool(tool: ToolDefinition): void {
  ensureToolProvider();
  pluginTools.set(tool.name, tool);
}

/** Register a slash command contributed by an m3 plugin. */
export function registerPluginCommand(name: string, handler: CommandHandler): void {
  registerCommand(name, handler);
  pluginCommands.set(name.toLowerCase(), handler);
}

/** Register a channel plugin from an m3 plugin. */
export function registerPluginChannel(plugin: ChannelPlugin): void {
  registerChannel(plugin);
}

export function listPluginTools(): string[] {
  return [...pluginTools.keys()].sort();
}

export function listPluginCommands(): string[] {
  return [...pluginCommands.keys()].sort();
}

export function clearPluginRegistry(): void {
  pluginTools.clear();
  pluginCommands.clear();
  installedPlugins.length = 0;
}

/** Install a plugin (calls register immediately). Skips duplicate ids. */
export function registerM3Plugin(plugin: M3Plugin): void {
  if (installedPlugins.some((p) => p.id === plugin.id)) return;
  installedPlugins.push(plugin);

  const api: M3PluginApi = {
    registerChannel: registerPluginChannel,
    registerTool: registerPluginTool,
    registerCommand: registerPluginCommand,
    log: (msg) => process.stderr.write(`[m3:plugin:${plugin.id}] ${msg}\n`),
  };
  plugin.register(api);
}

export function listInstalledPluginIds(): string[] {
  return installedPlugins.map((p) => p.id);
}
