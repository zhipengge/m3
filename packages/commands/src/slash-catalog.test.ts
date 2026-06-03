import { describe, expect, it } from "vitest";
import { completeSlashLine, formatSlashCommandMenu } from "./slash-catalog.js";

describe("slash-catalog", () => {
  it("completes partial slash commands", () => {
    const hits = completeSlashLine("/go");
    expect(hits).toContain("/goal");
    expect(hits.some((h) => h.startsWith("/"))).toBe(true);
  });

  it("lists all commands for bare slash", () => {
    const hits = completeSlashLine("/");
    expect(hits.length).toBeGreaterThan(10);
    expect(hits).toContain("/help");
    expect(hits).toContain("/compact");
  });

  it("returns empty for non-slash lines", () => {
    expect(completeSlashLine("hello")).toEqual([]);
  });

  it("formats menu with summaries", () => {
    const menu = formatSlashCommandMenu("hel");
    expect(menu).toContain("/help");
    expect(menu).toContain("List slash");
  });
});
