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
});
