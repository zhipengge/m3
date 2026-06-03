import { Command } from "commander";
import {
  formatModelsTable,
  getActiveModelRef,
  listConfiguredModels,
  loadConfig,
  loadSecrets,
  resolveConfigPath,
  resolveModelQuery,
  saveConfig,
  setActiveModel,
  tryResolveModel,
} from "@m3/config";
import { MODEL_PRESETS, localModelRef } from "@m3/local";

function localPresetRefs(): { ref: string; label: string }[] {
  return MODEL_PRESETS.map((p) => ({
    ref: localModelRef(p.id),
    label: p.displayName,
  }));
}

function extraLocalRefs(): string[] {
  return MODEL_PRESETS.map((p) => localModelRef(p.id));
}

export function registerModelCommands(program: Command): void {
  program
    .command("models")
    .description("List available models (cloud + local)")
    .option("--config <path>", "m3.json path")
    .option("--json", "Output as JSON")
    .action((opts: { config?: string; json?: boolean }) => {
      const config = loadConfig(opts.config);
      const secrets = loadSecrets();
      const configured = listConfiguredModels(config, secrets);
      const presets = localPresetRefs();

      if (opts.json) {
        console.log(
          JSON.stringify(
            {
              active: getActiveModelRef(config),
              configured,
              localPresets: presets,
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(formatModelsTable(config, secrets, { localRefs: presets }));
      console.log(`Config: ${resolveConfigPath(opts.config)}`);
    });

  program
    .command("model [ref]")
    .description("Show or set the active model (updates ~/.m3/m3.json)")
    .option("--config <path>", "m3.json path")
    .action((ref: string | undefined, opts: { config?: string }) => {
      const config = loadConfig(opts.config);
      const secrets = loadSecrets();
      const configPath = resolveConfigPath(opts.config);

      if (!ref?.trim()) {
        const active = getActiveModelRef(config);
        const check = tryResolveModel(config, secrets, active);
        console.log(`Active model: ${active}`);
        if (check.ok) {
          console.log(`Provider: ${check.resolved.providerId} (${check.resolved.api})`);
          console.log(`Model id: ${check.resolved.modelId}`);
          if (check.resolved.alias) console.log(`Alias: ${check.resolved.alias}`);
        } else {
          console.log(`Warning: ${check.error}`);
        }
        console.log(`\nList all: m3 models`);
        console.log(`Switch:   m3 model <ref>`);
        return;
      }

      try {
        const resolvedRef = resolveModelQuery(ref, config, extraLocalRefs());
        const next = setActiveModel(config, resolvedRef);
        saveConfig(next, opts.config);

        const check = tryResolveModel(next, secrets, resolvedRef);
        console.log(`Active model set to: ${resolvedRef}`);
        console.log(`Saved: ${configPath}`);

        if (resolvedRef.startsWith("local/")) {
          console.log("\nLocal model selected. Ensure weights & server are ready:");
          console.log("  m3 local status");
          console.log("  m3 local start");
        } else if (!check.ok) {
          console.log(`\nWarning: ${check.error}`);
        } else if (check.resolved.providerId !== "local") {
          const hasKey = Boolean(check.resolved.apiKey && check.resolved.apiKey !== "local");
          if (!hasKey) {
            console.log("\nWarning: no API key detected for this provider.");
            console.log("  Set ~/.m3/secrets.json or run: m3 doctor");
          } else {
            console.log("\nRestart m3 / gateway if already running to pick up the change.");
          }
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
