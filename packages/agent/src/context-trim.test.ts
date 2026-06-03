import { describe, expect, it } from "vitest";
import {
  applyContextBudget,
  compressConversationHistory,
  estimateContextUsageRatio,
  prepareMessagesForContext,
  shouldCompressContext,
  trimMessagesToBudget,
} from "./context-trim.js";
import type { HarnessMessage } from "./harness/types.js";

describe("trimMessagesToBudget", () => {
  it("keeps recent messages when budget is tight", () => {
    const messages: HarnessMessage[] = [
      { role: "user", content: "a".repeat(3000) },
      { role: "assistant", content: "b".repeat(3000) },
      { role: "user", content: "latest question" },
    ];
    const trimmed = trimMessagesToBudget(messages, 500);
    expect(trimmed.length).toBeLessThan(messages.length);
    expect(trimmed.at(-1)?.content).toBe("latest question");
  });
});

describe("applyContextBudget", () => {
  it("trims when system + history exceed window", () => {
    const messages: HarnessMessage[] = [
      { role: "user", content: "x".repeat(20_000) },
      { role: "user", content: "small" },
    ];
    const out = applyContextBudget({
      messages,
      maxContextTokens: 4096,
      maxOutputTokens: 1024,
      system: "sys",
      toolsJsonLength: 5000,
    });
    expect(out.length).toBeLessThanOrEqual(messages.length);
  });
});

describe("context compression at 90%", () => {
  const baseParams = {
    maxContextTokens: 10_000,
    maxOutputTokens: 1000,
    system: "system prompt",
    toolsJsonLength: 2000,
  };

  it("detects usage at or above 90%", () => {
    const messages: HarnessMessage[] = [
      { role: "user", content: "x".repeat(25_000) },
      { role: "assistant", content: "y".repeat(25_000) },
    ];
    const ratio = estimateContextUsageRatio({ ...baseParams, messages });
    expect(ratio).toBeGreaterThan(0.9);
    expect(shouldCompressContext({ ...baseParams, messages })).toBe(true);
  });

  it("compresses older turns and keeps recent tail", () => {
    const messages: HarnessMessage[] = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `message-${i}-${"z".repeat(800)}`,
    }));
    const { messages: out, summarizedTurns } = compressConversationHistory(messages);
    expect(out.length).toBeLessThan(messages.length);
    expect(summarizedTurns).toBe(6);
    expect(out[0]?.role).toBe("user");
    expect(String(out[0]?.content)).toContain("compressed");
    expect(out.at(-1)?.content).toContain("message-11");
  });

  it("prepareMessagesForContext returns separate session and api slices", () => {
    const messages: HarnessMessage[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: "m".repeat(4000),
    }));
    const prepared = prepareMessagesForContext({ ...baseParams, messages, maxContextTokens: 8000 });
    expect(prepared.compressed).toBe(true);
    expect(prepared.sessionMessages.length).toBeLessThan(messages.length);
    expect(prepared.apiMessages.length).toBeLessThanOrEqual(prepared.sessionMessages.length);
  });
});
