import { pathToFileURL } from "node:url";
import path from "node:path";
import { expandHome, type M3Config } from "@m3/config";
import { helloPlugin } from "./bundled/hello-plugin.js";
import {
  listInstalledPluginIds,
  listPluginCommands,
  listPluginTools,
  registerM3Plugin,
} from "./registry.js";
import type { M3Plugin } from "./types.js";

function isPluginEnabled(config: M3Config, pluginId: string): boolean {
  const entry = config.plugins?.entries?.[pluginId];
  if (entry && entry.enabled === false) return false;
  const allow = config.plugins?.allow;
  if (allow && allow.length > 0 && !allow.includes(pluginId)) return false;
  return true;
}

function registerBundledPlugins(config: M3Config): void {
  if (isPluginEnabled(config, "hello")) {
    registerM3Plugin(helloPlugin);
  }
}

async function loadPluginModule(modulePath: string): Promise<M3Plugin | null> {
  const resolved = expandHome(modulePath);
  const url = pathToFileURL(path.resolve(resolved)).href;
  const mod = (await import(url)) as { default?: M3Plugin; plugin?: M3Plugin };
  const plugin = mod.default ?? mod.plugin;
  if (!plugin?.id || typeof plugin.register !== "function") {
    throw new Error(`Invalid plugin module: ${resolved} (need default export M3Plugin)`);
  }
  return plugin;
}

/**
 * Load bundled + config-driven ESM plugins. Call before createAgentEngine so
 * tools/commands/channels are registered.
 */
export async function loadM3PluginsFromConfig(config: M3Config): Promise<{
  pluginIds: string[];
  toolNames: string[];
  commandNames: string[];
}> {
  registerBundledPlugins(config);

  for (const modulePath of config.plugins?.paths ?? []) {
    try {
      const plugin = await loadPluginModule(modulePath);
      if (plugin) registerM3Plugin(plugin);
    } catch (err) {
      process.stderr.write(
        `[m3:plugins] failed to load "${modulePath}": ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  return {
    pluginIds: listInstalledPluginIds(),
    toolNames: listPluginTools(),
    commandNames: listPluginCommands(),
  };
}
