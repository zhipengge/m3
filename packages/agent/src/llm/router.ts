import type { ProviderApi } from "@m3/config";
import { AnthropicLlmProvider } from "./anthropic-provider.js";
import { OpenAiChatProvider } from "./openai-provider.js";
import type { LlmProvider } from "./types.js";

const anthropic = new AnthropicLlmProvider();
const openai = new OpenAiChatProvider();

/**
 * Registry of LLM providers keyed by ProviderApi. Built-in providers are
 * pre-registered; third parties (or tests) can register additional providers
 * via `registerLlmProvider`. Lookup falls back to the built-in switch when
 * no custom provider is registered.
 */
const registry = new Map<ProviderApi, LlmProvider>();
registry.set("anthropic-messages", anthropic);
registry.set("openai-chat", openai);

/**
 * Register a custom LLM provider under a `ProviderApi` discriminator. Plugins
 * and experimental providers can call this once at module load. Re-registration
 * replaces the previous binding (useful for tests).
 */
export function registerLlmProvider(api: ProviderApi, provider: LlmProvider): void {
  registry.set(api, provider);
}

/** Remove a custom provider. No-op if not registered. */
export function unregisterLlmProvider(api: ProviderApi): void {
  registry.delete(api);
}

/** List the providers currently registered (built-in + custom). */
export function listLlmProviders(): ProviderApi[] {
  return [...registry.keys()];
}

export function getLlmProvider(api: ProviderApi): LlmProvider {
  const custom = registry.get(api);
  if (custom) return custom;
  switch (api) {
    case "anthropic-messages":
      return anthropic;
    case "openai-chat":
      return openai;
    default:
      throw new Error(`Unsupported provider API: ${api}`);
  }
}

export type { LlmProvider, LlmTurnParams, LlmTurnResult } from "./types.js";
export { DEFAULT_SYSTEM_PROMPT } from "./types.js";
export { AnthropicLlmProvider } from "./anthropic-provider.js";
export { OpenAiChatProvider } from "./openai-provider.js";
