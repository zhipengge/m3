import fs from "node:fs";
import { DEFAULT_CONFIG_PATH, expandHome, M3ConfigSchema, type M3Config } from "./schema.js";
import { atomicWriteFileSync } from "./fs-utils.js";

export * from "./schema.js";

export function loadConfig(configPath?: string): M3Config {
  const resolved = expandHome(configPath ?? DEFAULT_CONFIG_PATH);
  if (!fs.existsSync(resolved)) {
    return M3ConfigSchema.parse({});
  }
  const raw = JSON.parse(fs.readFileSync(resolved, "utf8")) as unknown;
  return M3ConfigSchema.parse(raw);
}

export function saveConfig(config: M3Config, configPath?: string): void {
  const resolved = expandHome(configPath ?? DEFAULT_CONFIG_PATH);
  // m3.json may carry webhook paths, tokens, and other sensitive routing
  // data. Write atomically and at 0o600 so a partial write doesn't
  // corrupt the config and a multi-user host can't read it.
  atomicWriteFileSync(resolved, JSON.stringify(config, null, 2));
}

export function resolveConfigPath(configPath?: string): string {
  return expandHome(configPath ?? DEFAULT_CONFIG_PATH);
}

export function configExists(configPath?: string): boolean {
  return fs.existsSync(resolveConfigPath(configPath));
}
