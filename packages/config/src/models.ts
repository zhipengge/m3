import { z } from "zod";

/** Provider API adapter — m3-owned, not Claude settings.json */
export const ProviderApiSchema = z.enum(["openai-chat", "anthropic-messages"]);

export const ModelEntrySchema = z.object({
  alias: z.string().optional(),
  maxTokens: z.number().int().min(256).max(128_000).optional(),
});

export const ModelProviderSchema = z.object({
  api: ProviderApiSchema.default("openai-chat"),
  baseUrl: z.string().url().optional(),
  /** Env var name for API key fallback, e.g. M3_DEEPSEEK_API_KEY */
  apiKeyEnv: z.string().optional(),
  models: z.record(ModelEntrySchema).default({}),
});

export const ModelsConfigSchema = z.object({
  default: z.string().default("deepseek/deepseek-chat"),
  providers: z
    .record(ModelProviderSchema)
    .default({
      deepseek: {
        api: "openai-chat",
        baseUrl: "https://api.deepseek.com",
        apiKeyEnv: "M3_DEEPSEEK_API_KEY",
        models: {
          "deepseek-chat": { alias: "DeepSeek Chat", maxTokens: 8192 },
          "deepseek-coder": { alias: "DeepSeek Coder", maxTokens: 8192 },
          "deepseek-reasoner": { alias: "DeepSeek Reasoner", maxTokens: 8192 },
        },
      },
      anthropic: {
        api: "anthropic-messages",
        apiKeyEnv: "M3_ANTHROPIC_API_KEY",
        models: {
          "claude-sonnet-4-6": { alias: "Claude Sonnet", maxTokens: 8192 },
        },
      },
    }),
});

export type ProviderApi = z.infer<typeof ProviderApiSchema>;
export type ModelEntry = z.infer<typeof ModelEntrySchema>;
export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;

export type ResolvedModel = {
  ref: string;
  providerId: string;
  modelId: string;
  api: ProviderApi;
  baseUrl?: string;
  apiKey: string;
  maxTokens: number;
  alias?: string;
};

export function parseModelRef(ref: string): { providerId: string; modelId: string } {
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) {
    throw new Error(`Invalid model ref "${ref}", expected provider/model`);
  }
  return {
    providerId: ref.slice(0, slash),
    modelId: ref.slice(slash + 1),
  };
}
