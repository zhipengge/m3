import { describe, expect, it } from "vitest";
import { M3ConfigSchema } from "./schema.js";
import { resolveModel } from "./resolve-model.js";
import { M3SecretsSchema } from "./secrets.js";

describe("M3ConfigSchema", () => {
  it("parses defaults with deepseek model", () => {
    const cfg = M3ConfigSchema.parse({});
    expect(cfg.gateway.port).toBe(18790);
    expect(cfg.agent.engine).toBe("native");
    expect(cfg.agent.model).toBe("deepseek/deepseek-chat");
    expect(cfg.models.default).toBe("deepseek/deepseek-chat");
    expect(cfg.models.providers.deepseek?.baseUrl).toBe("https://api.deepseek.com");
  });
});

describe("resolveModel", () => {
  it("resolves deepseek model ref with secrets", () => {
    const config = M3ConfigSchema.parse({});
    const secrets = M3SecretsSchema.parse({
      providers: { deepseek: { apiKey: "sk-test-key" } },
    });
    const resolved = resolveModel(config, secrets, "deepseek/deepseek-chat");
    expect(resolved.providerId).toBe("deepseek");
    expect(resolved.modelId).toBe("deepseek-chat");
    expect(resolved.api).toBe("openai-chat");
    expect(resolved.apiKey).toBe("sk-test-key");
  });

  it("resolves local provider without API key when localOnly", () => {
    const config = M3ConfigSchema.parse({
      models: {
        default: "local/qwen3-vl-4b-instruct",
        providers: {
          local: {
            api: "openai-chat",
            baseUrl: "http://127.0.0.1:8080/v1",
            localOnly: true,
            models: { "qwen3-vl-4b-instruct": { maxTokens: 8192 } },
          },
        },
      },
      agent: { model: "local/qwen3-vl-4b-instruct" },
    });
    const secrets = M3SecretsSchema.parse({});
    const resolved = resolveModel(config, secrets);
    expect(resolved.providerId).toBe("local");
    expect(resolved.apiKey).toBe("local");
    expect(resolved.baseUrl).toBe("http://127.0.0.1:8080/v1");
    expect(resolved.maxContextTokens).toBe(32_768);
  });

  it("resolves local model maxContextTokens", () => {
    const config = M3ConfigSchema.parse({
      agent: { model: "local/qwen3-vl-4b-instruct" },
      models: {
        default: "local/qwen3-vl-4b-instruct",
        providers: {
          local: {
            api: "openai-chat",
            baseUrl: "http://127.0.0.1:8080/v1",
            localOnly: true,
            models: {
              "qwen3-vl-4b-instruct": { maxTokens: 4096, maxContextTokens: 32768 },
            },
          },
        },
      },
    });
    const resolved = resolveModel(config, M3SecretsSchema.parse({}));
    expect(resolved.maxContextTokens).toBe(32768);
  });
});
