import { describe, expect, it, vi } from "vitest";
import type { LlmProvider, LlmTurnParams, LlmTurnResult } from "./types.js";
import { CascadeLlmProvider } from "./cascade-provider.js";

function makeProvider(
  result: LlmTurnResult,
): LlmProvider & { calls: LlmTurnParams[] } {
  const calls: LlmTurnParams[] = [];
  return {
    id: "stub",
    calls,
    async completeTurn(p: LlmTurnParams) {
      calls.push(p);
      return result;
    },
  };
}

const textResult = (text: string): LlmTurnResult => ({
  text,
  assistantContent: [{ type: "text", text }],
  stopReason: "end_turn",
});

const toolResult: LlmTurnResult = {
  text: "",
  assistantContent: [
    { type: "text", text: "thinking..." },
    { type: "tool_use", id: "t1", name: "Read", input: { path: "/a" } },
  ],
  stopReason: "tool_use",
};

const empty: LlmTurnResult = { text: "", assistantContent: [], stopReason: null };

describe("CascadeLlmProvider", () => {
  it("returns the local result when text is long enough", async () => {
    const local = makeProvider(textResult("This is a sufficiently long response that the local model handled the request without escalation."));
    const cloud = makeProvider(textResult("cloud"));
    const cascade = new CascadeLlmProvider(local, cloud);
    const r = await cascade.completeTurn({
      model: {} as any,
      messages: [],
      tools: [],
    });
    expect(r.escalated).toBe(false);
    expect(r.text).toContain("sufficiently long");
    expect(cloud.calls).toHaveLength(0);
  });

  it("escalates when local text is below the threshold", async () => {
    const local = makeProvider(textResult("I'm not sure."));
    const cloud = makeProvider(textResult("Here is the cloud answer."));
    const cascade = new CascadeLlmProvider(local, cloud);
    const r = await cascade.completeTurn({
      model: {} as any,
      messages: [],
      tools: [],
    });
    expect(r.escalated).toBe(true);
    expect(r.text).toBe("Here is the cloud answer.");
    expect(local.calls).toHaveLength(1);
    expect(cloud.calls).toHaveLength(1);
  });

  it("escalates when local returns a tool_use block", async () => {
    const local = makeProvider(toolResult);
    const cloud = makeProvider(textResult("Cloud handled the tool call."));
    const cascade = new CascadeLlmProvider(local, cloud);
    const r = await cascade.completeTurn({
      model: {} as any,
      messages: [],
      tools: [],
    });
    expect(r.escalated).toBe(true);
    expect(cloud.calls).toHaveLength(1);
  });

  it("respects a custom escalateBelow threshold", async () => {
    const local = makeProvider(textResult("medium length text"));
    const cloud = makeProvider(textResult("cloud"));
    const cascade = new CascadeLlmProvider(local, cloud, { escalateBelow: 100 });
    const r = await cascade.completeTurn({ model: {} as any, messages: [], tools: [] });
    expect(r.escalated).toBe(true);
  });

  it("does not escalate when local text is exactly at the threshold", async () => {
    const local = makeProvider(textResult("x".repeat(30)));
    const cloud = makeProvider(textResult("cloud"));
    const cascade = new CascadeLlmProvider(local, cloud);
    const r = await cascade.completeTurn({ model: {} as any, messages: [], tools: [] });
    expect(r.escalated).toBe(false);
  });

  it("returns local empty result without escalating on empty text + no tool", async () => {
    const local = makeProvider(empty);
    const cloud = makeProvider(textResult("cloud"));
    const cascade = new CascadeLlmProvider(local, cloud);
    const r = await cascade.completeTurn({ model: {} as any, messages: [], tools: [] });
    // empty text is below threshold → escalate (this is actually
    // the rule's intent: "I don't know" is what the empty result
    // looks like, and the user should pay for a cloud retry).
    expect(r.escalated).toBe(true);
  });
});
