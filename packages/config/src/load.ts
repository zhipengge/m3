import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CONFIG_PATH, expandHome, M3ConfigSchema, type M3Config } from "./schema.js";

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
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(config, null, 2));
}

export function resolveConfigPath(configPath?: string): string {
  return expandHome(configPath ?? DEFAULT_CONFIG_PATH);
}

export function configExists(configPath?: string): boolean {
  return fs.existsSync(resolveConfigPath(configPath));
}
