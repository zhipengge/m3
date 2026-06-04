import { describe, expect, it, beforeEach } from "vitest";
import {
  getLlmProvider,
  registerLlmProvider,
  unregisterLlmProvider,
  listLlmProviders,
  OpenAiChatProvider,
  AnthropicLlmProvider,
} from "./router.js";

describe("LLM router registry", () => {
  // Each test that registers a custom provider should also unregister it
  // to avoid leaking into other test files that import this module.
  beforeEach(() => {
    // best-effort: clean any test-only registrations
  });

  it("returns the built-in openai provider by default", () => {
    const p = getLlmProvider("openai-chat");
    expect(p.id).toBe("openai-chat");
    expect(p).toBeInstanceOf(OpenAiChatProvider);
  });

  it("returns the built-in anthropic provider by default", () => {
    const p = getLlmProvider("anthropic-messages");
    expect(p.id).toBe("anthropic-messages");
    expect(p).toBeInstanceOf(AnthropicLlmProvider);
  });

  it("throws on an unknown provider api", () => {
    // @ts-expect-error - intentionally invalid
    expect(() => getLlmProvider("nope")).toThrow(/Unsupported provider API/);
  });

  it("lets plugins register a custom provider", () => {
    const custom = { id: "openai-chat", completeTurn: async () => ({ text: "", assistantContent: [], stopReason: null }) };
    registerLlmProvider("openai-chat", custom);
    const p = getLlmProvider("openai-chat");
    expect(p).toBe(custom);
  });

  it("unregister restores the built-in provider", () => {
    const custom = { id: "openai-chat", completeTurn: async () => ({ text: "", assistantContent: [], stopReason: null }) };
    registerLlmProvider("openai-chat", custom);
    unregisterLlmProvider("openai-chat");
    const p = getLlmProvider("openai-chat");
    expect(p).toBeInstanceOf(OpenAiChatProvider);
  });

  it("listLlmProviders reports the registered set", () => {
    // Re-register the built-in (it may have been unregistered by an earlier test)
    registerLlmProvider("openai-chat", new OpenAiChatProvider());
    registerLlmProvider("anthropic-messages", new AnthropicLlmProvider());
    expect(listLlmProviders()).toContain("openai-chat");
    expect(listLlmProviders()).toContain("anthropic-messages");
    // Re-registering with the same key still reports one entry
    const custom = { id: "openai-chat" as const, completeTurn: async () => ({ text: "", assistantContent: [], stopReason: null as const }) };
    registerLlmProvider("openai-chat", custom);
    expect(listLlmProviders().filter((x) => x === "openai-chat").length).toBe(1);
  });
});
