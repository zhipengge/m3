import { describe, expect, it, vi } from "vitest";
import { AuditLog, redactSecrets, summarizeInput } from "./audit.js";

describe("redactSecrets", () => {
  it("redacts sk- style API keys", () => {
    expect(redactSecrets("token is sk-abcdefghijklmnop1234 end")).toContain("[REDACTED]");
    expect(redactSecrets("token is sk-abcdefghijklmnop1234 end")).not.toContain("sk-abcdefghijklmnop1234");
  });

  it("redacts GitHub tokens", () => {
    expect(redactSecrets("export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234")).not.toContain("ghp_");
  });

  it("redacts Slack tokens", () => {
    expect(redactSecrets("slack=xoxb-1234567890-abcdef")).not.toContain("xoxb-1234567890-abcdef");
  });

  it("redacts AWS access keys", () => {
    expect(redactSecrets("AKIAIOSFODNN7EXAMPLE logged")).not.toContain("AKIAIOSFODNN7EXAMPLE");
  });

  it("redacts key=value assignments of long values", () => {
    const r = redactSecrets("API_KEY=thisIsAReallyLongSecretValue12345 foo=bar");
    expect(r).not.toContain("thisIsAReallyLongSecretValue12345");
    expect(r).toContain("API_KEY=");
    expect(r).toContain("[REDACTED]");
    expect(r).toContain("foo=bar");
  });

  it("redacts token=… with separator preserved", () => {
    const r = redactSecrets("token: abcdefghijklmnop12345");
    expect(r).not.toContain("abcdefghijklmnop12345");
    // Either separator is fine; we just need the keyword + separator kept
    expect(r.includes("token=") || r.includes("token:")).toBe(true);
    expect(r).toContain("[REDACTED]");
  });

  it("redacts Authorization headers", () => {
    const r = redactSecrets("curl -H 'Authorization: Bearer abcdefghij1234567890'");
    expect(r).not.toContain("abcdefghij1234567890");
  });

  it("leaves benign input alone", () => {
    expect(redactSecrets("ls -la /tmp")).toBe("ls -la /tmp");
    expect(redactSecrets("hello world")).toBe("hello world");
    expect(redactSecrets("path=/usr/bin")).toBe("path=/usr/bin");
  });

  it("handles JSON-ish input", () => {
    const r = redactSecrets('{"apiKey":"sk-abcdefghijklmnop1234","name":"x"}');
    expect(r).not.toContain("sk-abcdefghijklmnop1234");
  });
});

describe("summarizeInput", () => {
  it("truncates long strings", () => {
    const long = "x".repeat(500);
    const s = summarizeInput(long, 50);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s).toMatch(/…$/);
  });

  it("redacts secrets before truncating", () => {
    const s = summarizeInput("sk-abcdefghijklmnop1234 and more text", 200);
    expect(s).not.toContain("sk-abcdefghijklmnop1234");
    expect(s).toContain("[REDACTED]");
  });

  it("handles non-string JSON-like input", () => {
    const s = summarizeInput({ command: "echo hi", secret: "sk-abcdefghijklmnop1234" });
    expect(s).not.toContain("sk-abcdefghijklmnop1234");
  });
});

describe("AuditLog", () => {
  it("emits a structured event with timestamp and redacts summary", () => {
    const sink = vi.fn();
    const log = new AuditLog(sink);
    log.record({
      sessionId: "s1",
      toolName: "Bash",
      decision: "allow",
      summary: "running with token sk-abcdefghijklmnop1234",
    });
    expect(sink).toHaveBeenCalledOnce();
    const evt = sink.mock.calls[0][0];
    expect(evt.toolName).toBe("Bash");
    expect(evt.decision).toBe("allow");
    expect(evt.ts).toMatch(/T.*Z$/);
    expect(evt.summary).not.toContain("sk-abcdefghijklmnop1234");
  });

  it("omits summary key when not provided", () => {
    const sink = vi.fn();
    new AuditLog(sink).record({ sessionId: "s1", toolName: "Read", decision: "allow" });
    const evt = sink.mock.calls[0][0];
    expect(evt.summary).toBeUndefined();
  });
});
