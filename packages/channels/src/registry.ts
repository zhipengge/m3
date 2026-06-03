import type { ChannelPlugin } from "./types.js";

const registry = new Map<string, ChannelPlugin>();

export function registerChannel(plugin: ChannelPlugin): void {
  registry.set(plugin.id, plugin);
}

export function getChannelPlugin(id: string): ChannelPlugin | undefined {
  return registry.get(id);
}

export function listChannelPlugins(): ChannelPlugin[] {
  return [...registry.values()];
}

export function clearChannelRegistry(): void {
  registry.clear();
}
