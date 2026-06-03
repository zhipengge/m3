import type { M3Config } from "@m3/config";
import { loadConfig, saveConfig } from "@m3/config";
import { DEFAULT_LLAMA_CTX_SIZE, DEFAULT_SERVER_PORT, LOCAL_PROVIDER_ID } from "./constants.js";
import { getServerBaseUrl } from "./llama-server.js";
import { localModelRef, resolveLocalModelInput, type ResolvedLocalModel } from "./model-spec.js";

export function applyLocalProviderConfig(
  config: M3Config,
  spec: ResolvedLocalModel,
  port: number = DEFAULT_SERVER_PORT,
  ctxSize: number = config.local?.ctxSize ?? spec.defaultCtxSize ?? DEFAULT_LLAMA_CTX_SIZE,
): M3Config {
  const baseUrl = getServerBaseUrl(port);
  const ref = localModelRef(spec.id);
  const providers = { ...config.models.providers };
  const existingLocal = providers[LOCAL_PROVIDER_ID]?.models ?? {};

  providers[LOCAL_PROVIDER_ID] = {
    api: "openai-chat",
    baseUrl,
    localOnly: true,
    models: {
      ...existingLocal,
      [spec.id]: {
        alias: `${spec.displayName} (local)`,
        maxTokens: 4096,
        maxContextTokens: ctxSize,
      },
    },
  };

  return {
    ...config,
    models: {
      ...config.models,
      default: ref,
      providers,
    },
    agent: {
      ...config.agent,
      engine: "native",
      model: ref,
    },
    local: {
      ...config.local,
      model: spec.id,
      repo: spec.repo,
      ctxSize,
      serverPort: port,
    },
  };
}

export function patchM3ConfigForLocal(
  configPath?: string,
  spec?: ResolvedLocalModel,
  port?: number,
  ctxSize?: number,
): string {
  const config = loadConfig(configPath);
  const resolved = spec ?? resolveLocalModelFromConfig(config);
  const next = applyLocalProviderConfig(
    config,
    resolved,
    port,
    ctxSize ?? config.local?.ctxSize,
  );
  saveConfig(next, configPath);
  return localModelRef(resolved.id);
}

function resolveLocalModelFromConfig(config: M3Config): ResolvedLocalModel {
  return resolveLocalModelInput(config.local?.model ?? config.local?.repo);
}
