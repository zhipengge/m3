import type { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  expandHome,
  loadConfig,
  loadSecrets,
  M3ConfigSchema,
  saveConfig,
  saveSecrets,
  secretsExists,
  type M3Config,
  type M3Secrets,
} from "@m3/config";
import { c, header, status, suggest, rule } from "./output.js";

/**
 * Locate the bundled example files shipped with the package. Works both from
 * source (`examples/…`) and from the published dist (where the example JSON is
 * co-located via package.json `files`).
 */
function resolveExample(filename: string): string {
  const candidates: string[] = [];
  // From source (packages/cli/src/init-command.ts → ../../.. → repo root)
  const here = path.dirname(fileURLToPath(import.meta.url));
  candidates.push(path.resolve(here, "..", "..", "..", "examples", filename));
  candidates.push(path.resolve(here, "..", "..", "examples", filename));
  // From dist (packages/cli/dist/src/init-command.js → ../../../examples)
  candidates.push(path.resolve(here, "..", "..", "..", "examples", filename));
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(`Bundled example not found: ${filename}`);
}

type InitOptions = { config?: string; force?: boolean; print?: boolean };

/**
 * `m3 init` — create `~/.m3/m3.json` and `~/.m3/secrets.json` from the bundled
 * examples, without overwriting existing files. Re-runnable; `--force` to
 * overwrite; `--print` to dump the would-be files to stdout (CI / review).
 */
export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Create ~/.m3/m3.json and ~/.m3/secrets.json from bundled examples")
    .option("--config <path>", "Target config path (default ~/.m3/m3.json)")
    .option("--force", "Overwrite existing config and secrets")
    .option("--print", "Print the example config + secrets to stdout instead of writing")
    .action((opts: InitOptions) => {
      runInit(opts);
    });
}

function runInit(opts: InitOptions): void {
  const m3Home = path.dirname(expandHome(opts.config ?? "~/.m3/m3.json"));
  fs.mkdirSync(m3Home, { recursive: true });

  if (opts.print) {
    const cfg = fs.readFileSync(resolveExample("m3.json"), "utf8");
    const sec = fs.readFileSync(resolveExample("secrets.json.example"), "utf8");
    console.log(cfg);
    console.log("--- secrets.json ---");
    console.log(sec);
    return;
  }

  header("init", "create ~/.m3/ configuration skeleton");

  const configPath = expandHome(opts.config ?? "~/.m3/m3.json");
  const secretsPath = expandHome("~/.m3/secrets.json");

  if (fs.existsSync(configPath) && !opts.force) {
    status("info", "Config", `${configPath} (already exists — use --force to overwrite)`);
  } else {
    const example = resolveExample("m3.json");
    const raw = fs.readFileSync(example, "utf8");
    // Validate before writing so we never persist a broken file
    const parsed = M3ConfigSchema.parse(JSON.parse(raw));
    saveConfig(parsed as M3Config, configPath);
    status(opts.force && fs.existsSync(configPath) ? "warn" : "ok", "Config", configPath);
  }

  if (secretsExists() && !opts.force) {
    status("info", "Secrets", `${secretsPath} (already exists — use --force to overwrite)`);
  } else {
    const example = resolveExample("secrets.json.example");
    const raw = fs.readFileSync(example, "utf8");
    const parsed = JSON.parse(raw) as M3Secrets;
    saveSecrets(parsed, secretsPath);
    try {
      fs.chmodSync(secretsPath, 0o600);
    } catch {
      /* best-effort on platforms that don't support chmod */
    }
    status(opts.force && fs.existsSync(secretsPath) ? "warn" : "ok", "Secrets", secretsPath);
  }

  rule();
  status("ok", "Next", "edit secrets, then run m3");

  const hints: string[] = [];
  try {
    const secrets = loadSecrets();
    const providers = Object.keys(secrets.providers ?? {});
    const missing = providers.filter((p) => !secrets.providers?.[p]?.apiKey);
    if (missing.length > 0) {
      hints.push(`Set API keys for: ${missing.join(", ")}`);
    }
  } catch {
    /* not critical */
  }
  try {
    const config = loadConfig(configPath);
    const channelCount = Object.values(config.channels).reduce(
      (n, accs) => n + Object.keys(accs ?? {}).length,
      0,
    );
    if (channelCount === 0) {
      hints.push("No channels configured — run: m3 channels configure");
    }
  } catch {
    /* not critical */
  }
  for (const h of hints) suggest(h);
  suggest(`Add keys:  ${c.brand(`$EDITOR ${secretsPath}`)}`);
  suggest(`Validate:  ${c.brand("m3 config validate")}`);
  suggest(`Start:     ${c.brand("m3 chat")}  ${c.muted("(or)")}  ${c.brand("m3")}`);
}
