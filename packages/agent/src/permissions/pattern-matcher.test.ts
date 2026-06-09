import { describe, expect, it } from "vitest";
import { matchPattern, findMatchingPattern } from "./pattern-matcher.js";

describe("matchPattern", () => {
  it("bare name matches", () => {
    expect(matchPattern("Read", "Read", { path: "/a" }).kind).toBe("name-only");
    expect(matchPattern("Read", "Bash", { path: "/a" }).kind).toBe("no-match");
  });

  it("substring filter (Bash / Read parens)", () => {
    expect(
      matchPattern("Bash(npm test:*)", "Bash", { command: "npm test:unit" }).kind,
    ).toBe("input-match");
    expect(
      matchPattern("Bash(npm test:*)", "Bash", { command: "rm -rf /" }).kind,
    ).toBe("no-match");
  });

  it("wildcards in substring filter", () => {
    expect(
      matchPattern("Read(/home/user/*)", "Read", { path: "/home/user/x.ts" }).kind,
    ).toBe("input-match");
    expect(
      matchPattern("Read(/home/user/*)", "Read", { path: "/etc/passwd" }).kind,
    ).toBe("no-match");
  });

  it("regex filter with flags", () => {
    expect(
      matchPattern("Bash(/rm\\s+-rf/i)", "Bash", { command: "RM -rf /tmp" }).kind,
    ).toBe("input-match");
  });

  it("rejects malformed regex gracefully", () => {
    // Bad regex → no match (don't crash the permission flow).
    expect(
      matchPattern("Bash(/[unclosed/i)", "Bash", { command: "x" }).kind,
    ).toBe("no-match");
  });

  it("name mismatch on filter patterns", () => {
    // Filter is for Bash, tool is Read — no match (don't accidentally
    // grant a different tool's filter to a different name).
    expect(matchPattern("Bash(npm:*)", "Read", { path: "/a" }).kind).toBe("no-match");
  });
});

describe("findMatchingPattern", () => {
  it("returns the first matching pattern (list order matters)", () => {
    const out = findMatchingPattern(
      ["Read(/safe/*)", "Read"],
      "Read",
      { path: "/safe/x.ts" },
    );
    expect(out?.pattern).toBe("Read(/safe/*)");
  });

  it("returns null when nothing matches", () => {
    expect(findMatchingPattern(["Read", "Write"], "Bash", { command: "ls" })).toBeNull();
  });
});
