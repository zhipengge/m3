import { describe, expect, it } from "vitest";
import {
  completeSlashLine,
  formatSlashCommandMenu,
  fuzzyScore,
  getSlashCommandSpecs,
  groupSlashCommandsByCategory,
  SLASH_CATEGORY_ORDER,
  SLASH_COMMAND_SPECS,
  type SlashCategory,
} from "./slash-catalog.js";

describe("fuzzyScore", () => {
  it("returns null when query is not a subsequence of name", () => {
    expect(fuzzyScore("clear", "xyz")).toBeNull();
  });

  it("returns 1 for empty query (matches everything)", () => {
    expect(fuzzyScore("clear", "")).toBe(1);
  });

  it("exact match scores highest", () => {
    const exact = fuzzyScore("clear", "clear")!;
    const prefix = fuzzyScore("clear", "cle")!;
    expect(exact).toBeGreaterThan(prefix);
  });

  it("prefix match scores higher than mid-string match", () => {
    const prefix = fuzzyScore("clear", "cl")!;
    const mid = fuzzyScore("unclear", "cl")!;
    expect(prefix).toBeGreaterThan(mid);
  });

  it("consecutive run bonus beats scattered match", () => {
    // "abc" is adjacent in "abc"; in "axbxc" it's scattered.
    const adjacent = fuzzyScore("abc", "abc")!;
    const scattered = fuzzyScore("axbxc", "abc")!;
    expect(adjacent).toBeGreaterThan(scattered);
  });
});

describe("slash-catalog", () => {
  it("completes partial slash commands (prefix)", () => {
    const hits = completeSlashLine("/go");
    expect(hits).toContain("/goal");
    expect(hits.some((h) => h.startsWith("/"))).toBe(true);
  });

  it("fuzzy-matches a non-prefix subsequence (e.g. /ct → /compact)", () => {
    const hits = completeSlashLine("/ct");
    expect(hits).toContain("/compact");
  });

  it("ranks exact match first", () => {
    const hits = completeSlashLine("/clear");
    expect(hits[0]).toBe("/clear");
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

describe("SLASH_CATEGORY_ORDER", () => {
  it("lists every category in a stable order", () => {
    const expected: SlashCategory[] = [
      "Core",
      "Mode",
      "Context",
      "Tooling",
      "Config",
      "Flow",
    ];
    expect(SLASH_CATEGORY_ORDER).toEqual(expected);
  });

  it("covers every category used by the spec list", () => {
    const used = new Set(SLASH_COMMAND_SPECS.map((s) => s.category));
    for (const c of used) {
      expect(SLASH_CATEGORY_ORDER).toContain(c);
    }
  });
});

describe("groupSlashCommandsByCategory", () => {
  it("groups every spec under its category", () => {
    const groups = groupSlashCommandsByCategory(SLASH_COMMAND_SPECS);
    const totalSpecs = groups.reduce((n, g) => n + g.specs.length, 0);
    expect(totalSpecs).toBe(SLASH_COMMAND_SPECS.length);
    for (const g of groups) {
      for (const s of g.specs) {
        expect(s.category).toBe(g.category);
      }
    }
  });

  it("buckets plugin-only commands under Core", () => {
    const out = getSlashCommandSpecs(["myplugin"]);
    const groups = groupSlashCommandsByCategory(out);
    const pluginGroup = groups.find((g) => g.specs.some((s) => s.name === "myplugin"));
    expect(pluginGroup?.category).toBe("Core");
  });

  it("preserves canonical category order", () => {
    const groups = groupSlashCommandsByCategory(SLASH_COMMAND_SPECS);
    const cats = groups.map((g) => g.category);
    expect(cats).toEqual(SLASH_CATEGORY_ORDER);
  });

  it("returns no groups for empty input", () => {
    expect(groupSlashCommandsByCategory([])).toEqual([]);
  });
});
