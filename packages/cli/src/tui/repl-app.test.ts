import { describe, expect, it } from "vitest";
import { findReverseISearchMatch } from "./repl-app.js";

describe("findReverseISearchMatch", () => {
  it("returns null on empty query", () => {
    expect(findReverseISearchMatch(["ls -la", "git status"], "")).toBeNull();
  });

  it("returns the most recent matching history line", () => {
    const history = [
      "git status",
      "pnpm test",
      "git checkout main",
      "ls -la",
    ];
    expect(findReverseISearchMatch(history, "git")).toBe("git checkout main");
  });

  it("is case-insensitive", () => {
    const history = ["Pnpm Test", "git status"];
    expect(findReverseISearchMatch(history, "pnpm")).toBe("Pnpm Test");
  });

  it("returns null when no match", () => {
    expect(findReverseISearchMatch(["ls", "git"], "kubectl")).toBeNull();
  });

  it("handles empty history", () => {
    expect(findReverseISearchMatch([], "x")).toBeNull();
  });
});
