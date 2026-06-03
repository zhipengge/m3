import type { AgentConfig, M3Config, ResolvedModel } from "@m3/config";
import { loadConfig, loadSecrets, resolveModel } from "@m3/config";
import { createNativeEngine } from "./harness/native-engine.js";
import { createLegacyCliEngine } from "./legacy/cli-engine.js";
import { createMockEngine } from "./mock-engine.js";
import type { AgentEngine } from "./types.js";

export type CreateEngineOptions = {
  config: AgentConfig;
  m3Config?: M3Config;
  model?: ResolvedModel;
  mock?: boolean;
  mockResponder?: (prompt: string) => string;
};

export function createAgentEngine(options: CreateEngineOptions): AgentEngine {
  if (options.mock || process.env.M3_MOCK_AGENT === "1" || options.config.engine === "mock") {
    return createMockEngine(options.mockResponder);
  }
  if (options.config.engine === "legacy-cli") {
    return createLegacyCliEngine(options.config);
  }

  const m3Config = options.m3Config ?? loadConfig();
  const secrets = loadSecrets();
  const model = options.model ?? resolveModel(m3Config, secrets, options.config.model);

  return createNativeEngine({
    agent: options.config,
    model,
  });
}

export function resolveAgentModel(m3Config: M3Config, modelRef?: string): ResolvedModel {
  return resolveModel(m3Config, loadSecrets(), modelRef);
}
