import { describe, expect, it, beforeEach } from "vitest";
import type { M3Config } from "@m3/config";
import { clearPluginRegistry } from "./registry.js";
import { loadM3PluginsFromConfig } from "./load-plugins.js";

describe("loadM3PluginsFromConfig", () => {
  beforeEach(() => {
    clearPluginRegistry();
  });

  it("loads bundled hello plugin by default", async () => {
    const config = { plugins: {} } as unknown as M3Config;
    const result = await loadM3PluginsFromConfig(config);
    expect(result.pluginIds).toContain("hello");
    expect(result.toolNames).toContain("HelloEcho");
    expect(result.commandNames).toContain("hello-plugin");
  });

  it("skips hello when disabled in entries", async () => {
    const config = {
      plugins: { entries: { hello: { enabled: false } } },
    } as unknown as M3Config;
    const result = await loadM3PluginsFromConfig(config);
    expect(result.pluginIds).not.toContain("hello");
  });
});
