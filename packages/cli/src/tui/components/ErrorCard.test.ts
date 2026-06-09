import { describe, expect, it } from "vitest";
import { classifyError } from "./ErrorCard.js";

describe("classifyError", () => {
  it("identifies network errors by status code", () => {
    expect(classifyError("HTTP 401 Unauthorized")).toBe("network");
    expect(classifyError("status: 429 too many requests")).toBe("network");
    expect(classifyError("HTTP 500 internal error")).toBe("network");
    expect(classifyError("HTTP 502 bad gateway")).toBe("network");
    expect(classifyError("HTTP 503 service unavailable")).toBe("network");
  });

  it("identifies network errors by ECONNRESET / timeout / rate limit", () => {
    expect(classifyError("ECONNRESET during read")).toBe("network");
    expect(classifyError("getaddrinfo ENOTFOUND api.example.com")).toBe("network");
    expect(classifyError("connection timed out after 30s")).toBe("network");
    expect(classifyError("rate limit exceeded, retry in 60s")).toBe("network");
  });

  it("identifies context overflow", () => {
    expect(classifyError("max_tokens exceeded (8192)")).toBe("context_overflow");
    expect(classifyError("context length exceeded")).toBe("context_overflow");
    expect(classifyError("input too long, please shorten")).toBe("context_overflow");
  });

  it("identifies parse errors", () => {
    expect(classifyError("JSON.parse: unexpected token at position 12")).toBe("parse");
    expect(classifyError("SyntaxError: Unexpected token")).toBe("parse");
    expect(classifyError("parse failed: malformed tool call")).toBe("parse");
  });

  it("falls back to unknown for unclassified messages", () => {
    expect(classifyError("something happened")).toBe("unknown");
    expect(classifyError("")).toBe("unknown");
    expect(classifyError("file not found")).toBe("unknown");
  });
});
