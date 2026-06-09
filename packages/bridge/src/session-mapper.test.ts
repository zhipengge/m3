import { describe, expect, it } from "vitest";
import { inboundToPrompt, inboundToUserMessage } from "./session-mapper.js";

describe("inboundToPrompt (legacy text-form)", () => {
  it("appends attachment paths for multimodal messages", () => {
    const prompt = inboundToPrompt("see this", [
      { type: "image", path: "/tmp/a.png", mimeType: "image/png" },
    ]);
    expect(prompt).toContain("see this");
    expect(prompt).toContain("[Attachments");
    expect(prompt).toContain("/tmp/a.png");
  });

  it("returns the body unchanged when there is no media", () => {
    expect(inboundToPrompt("hi")).toBe("hi");
    expect(inboundToPrompt("  hi  ")).toBe("hi");
  });
});

describe("inboundToUserMessage (image pipeline)", () => {
  it("returns a plain string content when there is no media", () => {
    const msg = inboundToUserMessage("hello");
    expect(msg).toEqual({ role: "user", content: "hello" });
  });

  it("synthesises a placeholder when only image media is provided", () => {
    const msg = inboundToUserMessage("", [{ type: "image", path: "/tmp/a.png" }]);
    if (typeof msg.content === "string") throw new Error("expected blocks");
    expect(msg.content[0]).toMatchObject({ type: "text", text: "[image attached]" });
    expect(msg.content[1]).toMatchObject({
      type: "image",
      source: { kind: "path", path: "/tmp/a.png", mimeType: "image/png" },
    });
  });

  it("keeps the user's text and appends the image block", () => {
    const msg = inboundToUserMessage("describe", [
      { type: "image", path: "/tmp/a.jpg", mimeType: "image/jpeg" },
    ]);
    if (typeof msg.content === "string") throw new Error("expected blocks");
    expect(msg.content[0]).toMatchObject({ type: "text", text: "describe" });
    expect(msg.content[1]).toMatchObject({
      type: "image",
      source: { kind: "path", path: "/tmp/a.jpg", mimeType: "image/jpeg" },
    });
  });

  it("falls back to legacy path-as-text when there are no image attachments", () => {
    const msg = inboundToUserMessage("read this", [
      { type: "file", path: "/tmp/report.pdf", mimeType: "application/pdf" },
    ]);
    expect(msg.content).toContain("[Attachments");
  });

  it("mixes text + file references when an image is co-attached with a file", () => {
    const msg = inboundToUserMessage("see", [
      { type: "image", path: "/tmp/a.png" },
      { type: "file", path: "/tmp/b.pdf" },
    ]);
    if (typeof msg.content === "string") throw new Error("expected blocks");
    const types = msg.content.map((b) => b.type);
    expect(types).toEqual(["text", "image", "text"]);
    const fileBlock = msg.content[2];
    if (fileBlock.type !== "text") throw new Error();
    expect(fileBlock.text).toContain("/tmp/b.pdf");
  });
});
