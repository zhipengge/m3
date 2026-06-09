import { describe, expect, it } from "vitest";
import { sliceVisible, truncateMiddle } from "./wrap.js";

describe("truncateMiddle", () => {
  it("returns input unchanged when it fits", () => {
    expect(truncateMiddle("hello", 20)).toBe("hello");
  });

  it("truncates in the middle, preserving head and tail", () => {
    const out = truncateMiddle("/usr/local/share/very/long/path/file.ts", 20);
    // Head + ellipsis + tail = ≤ maxWidth
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.startsWith("/")).toBe(true);
    expect(out.endsWith("file.ts")).toBe(true);
    expect(out.includes("…")).toBe(true);
  });

  it("returns ellipsis for maxWidth <= 1", () => {
    expect(truncateMiddle("hello", 1)).toBe("…");
    expect(truncateMiddle("hello", 0)).toBe("…");
  });

  it("keeps at least 1 char on each side", () => {
    // 100-char string, max 5 → at minimum "a…zzz" (1 + 1 + 3)
    const out = truncateMiddle("a".repeat(50) + "z".repeat(50), 5);
    expect(out.startsWith("a")).toBe(true);
    expect(out.endsWith("z")).toBe(true);
  });
});

describe("sliceVisible", () => {
  it("returns the input when under both caps", () => {
    const r = sliceVisible("a\nb\nc", { maxChars: 100, maxLines: 100 });
    expect(r.display).toBe("a\nb\nc");
    expect(r.hiddenChars).toBe(0);
    expect(r.hiddenLines).toBe(0);
  });

  it("truncates by line count", () => {
    const r = sliceVisible("a\nb\nc\nd\ne", { maxLines: 3 });
    expect(r.display).toBe("a\nb\nc");
    expect(r.hiddenLines).toBe(2);
  });

  it("truncates by char count", () => {
    const r = sliceVisible("x".repeat(200), { maxChars: 50 });
    expect(r.display.length).toBe(50);
    expect(r.hiddenChars).toBe(150);
  });

  it("truncates long single lines to lineWidth via middle-truncate", () => {
    const r = sliceVisible("a".repeat(500), { lineWidth: 20 });
    expect(r.display.length).toBeLessThanOrEqual(20);
    expect(r.display.includes("…")).toBe(true);
  });
});
