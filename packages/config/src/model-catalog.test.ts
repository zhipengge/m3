import { describe, expect, it } from "vitest";
import { M3ConfigSchema } from "./schema.js";
import {
  getActiveModelRef,
  listConfiguredModels,
  resolveModelQuery,
  setActiveModel,
} from "./model-catalog.js";

describe("model-catalog", () => {
  const config = M3ConfigSchema.parse({
    agent: { model: "deepseek/deepseek-chat" },
    models: { default: "deepseek/deepseek-chat" },
  });

  it("lists configured models", () => {
    const list = listConfiguredModels(config);
    expect(list.some((m) => m.ref === "deepseek/deepseek-chat")).toBe(true);
  });

  it("resolves by model id", () => {
    expect(resolveModelQuery("deepseek-chat", config)).toBe("deepseek/deepseek-chat");
  });

  it("sets active model", () => {
    const next = setActiveModel(config, "anthropic/claude-sonnet-4-6");
    expect(getActiveModelRef(next)).toBe("anthropic/claude-sonnet-4-6");
  });

  it("resolves local preset ref", () => {
    expect(resolveModelQuery("qwen3-vl-4b-instruct", config, ["local/qwen3-vl-4b-instruct"])).toBe(
      "local/qwen3-vl-4b-instruct",
    );
  });
});
