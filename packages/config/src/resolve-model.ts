import type { M3Config } from "./schema.js";
import { parseModelRef, type ResolvedModel } from "./models.js";
import { type M3Secrets } from "./secrets.js";

export function resolveModel(
  config: Pick<M3Config, "models" | "agent">,
  secrets: M3Secrets,
  modelRef?: string,
): ResolvedModel {
  const ref = modelRef ?? config.agent.model ?? config.models.default;
  const { providerId, modelId } = parseModelRef(ref);
  const provider = config.models.providers[providerId];
  if (!provider) {
    throw new Error(`Unknown model provider "${providerId}" in ref "${ref}"`);
  }

  const modelEntry = provider.models[modelId];
  if (!modelEntry) {
    throw new Error(`Unknown model "${modelId}" for provider "${providerId}"`);
  }

  let apiKey = resolveProviderApiKey(providerId, provider.apiKeyEnv, secrets);
  if (!apiKey && provider.localOnly) {
    apiKey = "local";
  }
  if (!apiKey) {
    throw new Error(
      `No API key for provider "${providerId}". Set ~/.m3/secrets.json or env ${provider.apiKeyEnv ?? `M3_${providerId.toUpperCase()}_API_KEY`}`,
    );
  }

  const maxTokens = modelEntry.maxTokens ?? 8192;
  return {
    ref,
    providerId,
    modelId,
    api: provider.api,
    baseUrl: provider.baseUrl,
    apiKey,
    maxTokens,
    maxContextTokens: modelEntry.maxContextTokens ?? maxTokens * 4,
    alias: modelEntry.alias,
  };
}

function resolveProviderApiKey(
  providerId: string,
  apiKeyEnv: string | undefined,
  secrets: M3Secrets,
): string | undefined {
  const fromSecrets = secrets.providers[providerId]?.apiKey;
  if (fromSecrets) return fromSecrets;

  if (apiKeyEnv && process.env[apiKeyEnv]) {
    return process.env[apiKeyEnv];
  }

  const generic = process.env[`M3_${providerId.toUpperCase()}_API_KEY`];
  if (generic) return generic;

  if (providerId === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }
  if (providerId === "deepseek" && process.env.DEEPSEEK_API_KEY) {
    return process.env.DEEPSEEK_API_KEY;
  }
  if (providerId === "minimax" && process.env.MINIMAX_API_KEY) {
    return process.env.MINIMAX_API_KEY;
  }

  return undefined;
}
