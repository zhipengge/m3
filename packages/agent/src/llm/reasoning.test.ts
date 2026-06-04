import { describe, expect, it } from "vitest";
import { extractOpenAiReasoningDelta, modelUsesReasoningSplit } from "./reasoning.js";

describe("modelUsesReasoningSplit", () => {
  it("detects MiniMax and DeepSeek reasoner", () => {
    expect(modelUsesReasoningSplit("MiniMax-M3")).toBe(true);
    expect(modelUsesReasoningSplit("deepseek-reasoner")).toBe(true);
    expect(modelUsesReasoningSplit("deepseek-chat")).toBe(false);
  });
});

describe("extractOpenAiReasoningDelta", () => {
  it("parses reasoning_content increments", () => {
    const a = extractOpenAiReasoningDelta({ reasoning_content: "hi" }, "");
    expect(a).toEqual({ delta: "hi", cumulative: "hi" });
    const b = extractOpenAiReasoningDelta({ reasoning_content: " there" }, "hi");
    expect(b).toEqual({ delta: " there", cumulative: "hi there" });
  });

  it("parses cumulative reasoning_content snapshots", () => {
    const a = extractOpenAiReasoningDelta({ reasoning_content: "hello" }, "");
    expect(a?.cumulative).toBe("hello");
    const b = extractOpenAiReasoningDelta({ reasoning_content: "hello world" }, "hello");
    expect(b).toEqual({ delta: " world", cumulative: "hello world" });
  });

  it("parses cumulative reasoning_details", () => {
    const a = extractOpenAiReasoningDelta(
      { reasoning_details: [{ text: "step" }] },
      "",
    );
    expect(a).toEqual({ delta: "step", cumulative: "step" });
    const b = extractOpenAiReasoningDelta(
      { reasoning_details: [{ text: "step one" }] },
      "step",
    );
    expect(b).toEqual({ delta: " one", cumulative: "step one" });
  });
});
