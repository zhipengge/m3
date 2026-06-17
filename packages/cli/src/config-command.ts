import type { Command } from "commander";
import fs from "node:fs";
import { loadConfig, resolveConfigPath } from "@m3/config";
import { M3ConfigSchema } from "@m3/config";
import { header, status, suggest, c, rule } from "./output.js";

/**
 * `m3 config` — view, validate, and locate the active configuration.
 *
 *   m3 config                  # show resolved config path + summary
 *   m3 config path             # print the resolved config file path
 *   m3 config validate         # check the file against M3ConfigSchema
 *   m3 config show             # print the full config as JSON
 */
export function registerConfigCommand(program: Command): void {
  const cmd = program.command("config").description("View, validate, or print the m3 config");

  cmd
    .command("path", { isDefault: false })
    .description("Print the resolved config file path")
    .option("--config <path>", "Config file path")
    .action((opts: { config?: string }) => {
      console.log(resolveConfigPath(opts.config));
    });

  cmd
    .command("validate")
    .description("Validate the config against the schema")
    .option("--config <path>", "Config file path")
    .action((opts: { config?: string }) => {
      const path = resolveConfigPath(opts.config);
      const exists = fs.existsSync(path);
      header("config validate", path);
      status("info", "File", exists ? "found" : "missing");
      if (!exists) {
        status("warn", "Result", "no file — defaults will be used");
        suggest("Run: m3 install (creates ~/.m3/m3.json)");
        return;
      }
      try {
        const raw = JSON.parse(fs.readFileSync(path, "utf8"));
        const parsed = M3ConfigSchema.safeParse(raw);
        if (parsed.success) {
          status("ok", "Result", "valid");
          return;
        }
        status("err", "Result", `${parsed.error.issues.length} issue(s)`);
        for (const issue of parsed.error.issues) {
          const path = issue.path.length ? issue.path.join(".") : "(root)";
          console.log(`  ${c.err("✗")} ${c.bold(path)}: ${issue.message}`);
        }
        suggest("Fix the listed keys in m3.json, or run: m3 config show");
        process.exitCode = 1;
      } catch (err) {
        status("err", "Result", err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  cmd
    .command("show")
    .description("Print the effective config as JSON (defaults merged)")
    .option("--config <path>", "Config file path")
    .action((opts: { config?: string }) => {
      const config = loadConfig(opts.config);
      console.log(JSON.stringify(config, null, 2));
    });

  cmd
    .command("summary", { isDefault: true })
    .description("Show a one-screen summary of the active config")
    .option("--config <path>", "Config file path")
    .action((opts: { config?: string }) => {
      const path = resolveConfigPath(opts.config);
      const config = loadConfig(opts.config);
      header("config", path);
      status("info", "Gateway", `${config.gateway.bind}:${config.gateway.port}`);
      status("info", "Auth token", config.gateway.authToken ? "set" : "not set");
      status("info", "Engine", config.agent.engine);
      status("info", "Permission mode", config.agent.permissionMode);
      status("info", "Channel perm mode", config.agent.channelPermissionMode ?? "default");
      status("info", "Sandbox", config.agent.sandbox?.enabled !== false ? "enabled" : "disabled");
      status("info", "Default model", config.models.default);
      status("info", "Active model", config.agent.model);
      const channelCount = Object.values(config.channels).reduce(
        (n, accs) => n + Object.keys(accs ?? {}).length,
        0,
      );
      status("info", "Channel accounts", String(channelCount));
      status("info", "Skill dirs", (config.agent.skills?.dirs ?? []).join(", ") || "(none)");
      status("info", "MCP config", config.agent.mcp?.config ?? "(not set)");
      rule();
      suggest("Run: m3 config validate | m3 config show | m3 doctor");
    });
}
