import { describe, expect, it } from "vitest";
import { inboundToPrompt } from "./session-mapper.js";

describe("inboundToPrompt", () => {
  it("appends attachment paths for multimodal messages", () => {
    const prompt = inboundToPrompt("see this", [
      { type: "image", path: "/tmp/a.png", mimeType: "image/png" },
    ]);
    expect(prompt).toContain("see this");
    expect(prompt).toContain("[Attachments");
    expect(prompt).toContain("/tmp/a.png");
  });
});
