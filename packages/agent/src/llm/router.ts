import type { ProviderApi } from "@m3/config";
import { AnthropicLlmProvider } from "./anthropic-provider.js";
import { OpenAiChatProvider } from "./openai-provider.js";
import type { LlmProvider } from "./types.js";

const anthropic = new AnthropicLlmProvider();
const openai = new OpenAiChatProvider();

export function getLlmProvider(api: ProviderApi): LlmProvider {
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
