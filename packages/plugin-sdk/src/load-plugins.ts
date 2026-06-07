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
import {
  checkPluginSha,
  loadPluginShaStore,
  recordPluginSha,
  savePluginShaStore,
} from "./plugin-shas.js";

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
 *
 * Plugin files are SHA-pinned on first load (TOFU — trust on first use)
 * via `~/.m3/plugin-shas.json`. A plugin whose file contents change
 * between runs is refused with a clear error; the user can review the
 * mismatch and either remove the record (force re-trust) or restore the
 * file. Without this, a write to `m3.json` could silently load arbitrary
 * code into the agent process.
 */
export async function loadM3PluginsFromConfig(config: M3Config): Promise<{
  pluginIds: string[];
  toolNames: string[];
  commandNames: string[];
}> {
  registerBundledPlugins(config);

  const shaStore = loadPluginShaStore();
  let shaStoreDirty = false;

  for (const modulePath of config.plugins?.paths ?? []) {
    const resolved = expandHome(modulePath);
    let plugin: M3Plugin | null = null;
    try {
      // Compute / verify SHA *before* dynamic import. Importing a
      // tampered module is the entire threat model — checking after
      // the fact would be useless.
      // Plugin id is unknown until we import; use the path as a
      // temporary key and verify after import.
      const shaCheck = checkPluginSha(resolved, "(pending)", shaStore);
      if (shaCheck.kind === "mismatch") {
        process.stderr.write(
          `[m3:plugins] SHA mismatch for "${modulePath}" — refusing to load.\n` +
            `  recorded: ${shaCheck.previousSha}\n` +
            `  current:  ${shaCheck.currentSha}\n` +
            `If this change is intentional, delete ~/.m3/plugin-shas.json or remove the record for this path.\n`,
        );
        continue;
      }
      plugin = await loadPluginModule(modulePath);
      if (!plugin) continue;
      // Now that we have the plugin id, re-check / record with the real id.
      const recheck = checkPluginSha(resolved, plugin.id, shaStore);
      if (recheck.kind === "mismatch") {
        process.stderr.write(
          `[m3:plugins] SHA mismatch for "${modulePath}" (id=${plugin.id}) — refusing to load.\n`,
        );
        continue;
      }
      if (recheck.kind === "first-use") {
        recordPluginSha(resolved, plugin.id, shaStore);
        shaStoreDirty = true;
        process.stderr.write(
          `[m3:plugins] first-use trust recorded for "${modulePath}" (id=${plugin.id})\n`,
        );
      }
      registerM3Plugin(plugin);
    } catch (err) {
      process.stderr.write(
        `[m3:plugins] failed to load "${modulePath}": ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  if (shaStoreDirty) savePluginShaStore(shaStore);

  return {
    pluginIds: listInstalledPluginIds(),
    toolNames: listPluginTools(),
    commandNames: listPluginCommands(),
  };
}
