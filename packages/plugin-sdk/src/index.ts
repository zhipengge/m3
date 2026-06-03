import type { M3Plugin } from "./types.js";
import {
  clearPluginRegistry,
  listInstalledPluginIds,
  listPluginCommands,
  listPluginTools,
  registerM3Plugin,
  registerPluginChannel,
  registerPluginCommand,
  registerPluginTool,
} from "./registry.js";

export type { M3Plugin, M3PluginApi } from "./types.js";

export function definePlugin(plugin: M3Plugin): M3Plugin {
  return plugin;
}

export {
  clearPluginRegistry,
  listInstalledPluginIds,
  listPluginCommands,
  listPluginTools,
  registerM3Plugin,
  registerPluginChannel,
  registerPluginCommand,
  registerPluginTool,
};

export { helloPlugin } from "./bundled/hello-plugin.js";
export { loadM3PluginsFromConfig } from "./load-plugins.js";
