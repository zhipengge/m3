import fs from "node:fs";
import { ZodError } from "zod";
import { DEFAULT_CONFIG_PATH, expandHome, M3ConfigSchema, type M3Config } from "./schema.js";
import { atomicWriteFileSync } from "./fs-utils.js";

export * from "./schema.js";

export class ConfigParseError extends Error {
  readonly path: string;
  readonly issues?: ReadonlyArray<{ path: string; message: string }>;
  readonly cause: unknown;
  constructor(filePath: string, cause: unknown) {
    let detail: string;
    let issues: ConfigParseError["issues"];
    if (cause instanceof ZodError) {
      issues = cause.issues.map((i) => ({
        path: i.path.length > 0 ? i.path.join(".") : "(root)",
        message: i.message,
      }));
      const sample = issues
        .slice(0, 3)
        .map((i) => `  - ${i.path}: ${i.message}`)
        .join("\n");
      detail = `Schema validation failed:\n${sample}${issues.length > 3 ? `\n  …and ${issues.length - 3} more` : ""}`;
    } else if (cause instanceof SyntaxError) {
      detail = `JSON syntax error: ${cause.message}`;
    } else {
      detail = cause instanceof Error ? cause.message : String(cause);
    }
    super(
      `Invalid config at ${filePath}.\n${detail}\nRun: m3 config validate`,
    );
    this.name = "ConfigParseError";
    this.path = filePath;
    this.issues = issues;
    this.cause = cause;
  }
}

export function loadConfig(configPath?: string): M3Config {
  const resolved = expandHome(configPath ?? DEFAULT_CONFIG_PATH);
  if (!fs.existsSync(resolved)) {
    return M3ConfigSchema.parse({});
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(resolved, "utf8")) as unknown;
  } catch (err) {
    throw new ConfigParseError(resolved, err);
  }
  try {
    return M3ConfigSchema.parse(raw);
  } catch (err) {
    throw new ConfigParseError(resolved, err);
  }
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
