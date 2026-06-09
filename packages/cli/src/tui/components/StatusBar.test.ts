import { describe, expect, it } from "vitest";
import { buildStatusBarText, fmtTokens } from "./StatusBar.js";

describe("fmtTokens", () => {
  it("formats small numbers without suffix", () => {
    expect(fmtTokens(0)).toBe("0");
    expect(fmtTokens(1)).toBe("1");
    expect(fmtTokens(999)).toBe("999");
  });

  it("formats thousands with one decimal under 10k, no decimal at/above 10k", () => {
    expect(fmtTokens(1000)).toBe("1.0k");
    expect(fmtTokens(1234)).toBe("1.2k");
    expect(fmtTokens(9999)).toBe("10.0k");
    expect(fmtTokens(10000)).toBe("10k");
    expect(fmtTokens(82000)).toBe("82k");
  });

  it("formats millions", () => {
    expect(fmtTokens(1_500_000)).toBe("1.5M");
    expect(fmtTokens(12_000_000)).toBe("12M");
  });
});

describe("buildStatusBarText", () => {
  it("renders model and dashboard", () => {
    expect(
      buildStatusBarText({ model: "m", dashboardUrl: "http://h" }),
    ).toContain("m");
    expect(
      buildStatusBarText({ model: "m", dashboardUrl: "http://h" }),
    ).toContain("http://h");
  });

  it("includes token segment with ↑/↓ arrows when totals are present", () => {
    const out = buildStatusBarText({
      model: "m",
      tokens: { input: 8200, output: 4200, total: 12400 },
    });
    // 12.4k total rounds to 12k at >=10k; per-turn values <10k keep one decimal.
    expect(out).toMatch(/tok 12k/);
    expect(out).toMatch(/↑8\.2k/);
    expect(out).toMatch(/↓4\.2k/);
  });

  it("omits the token segment when no usage has been reported", () => {
    expect(buildStatusBarText({ model: "m" })).not.toContain("tok");
  });

  it("omits the token segment when both counters are zero", () => {
    expect(
      buildStatusBarText({ model: "m", tokens: { input: 0, output: 0, total: 0 } }),
    ).not.toContain("tok");
  });

  it("includes ctx percentage when provided", () => {
    expect(buildStatusBarText({ model: "m", contextPct: 0.42 })).toContain("ctx 42%");
  });

  it("flags ≥90% context as ≥90% in the bar (warn color)", () => {
    // The new visual bar replaces the text "compress soon" hint with
    // a colored bar; we just assert the percentage still appears.
    const out = buildStatusBarText({ model: "m", contextPct: 0.92 });
    expect(out).toContain("92%");
  });

  it("falls back to the brand name when nothing is set", () => {
    expect(buildStatusBarText({})).toBe("m3");
  });

  it("includes USD cost when tokens carry costUsd", () => {
    expect(
      buildStatusBarText({
        model: "m",
        tokens: { input: 1000, output: 500, total: 1500, costUsd: 0.0123 },
      }),
    ).toContain("cost");
    expect(
      buildStatusBarText({
        model: "m",
        tokens: { input: 1000, output: 500, total: 1500, costUsd: 0.0123 },
      }),
    ).toMatch(/cost \$\d+\.\d+/);
  });

  it("hides the cost segment when costUsd is 0 or undefined", () => {
    expect(
      buildStatusBarText({
        model: "m",
        tokens: { input: 1000, output: 500, total: 1500, costUsd: 0 },
      }),
    ).not.toContain("cost");
    expect(
      buildStatusBarText({
        model: "m",
        tokens: { input: 1000, output: 500, total: 1500 },
      }),
    ).not.toContain("cost");
  });

  it("formats larger costs with 1 decimal ($12.5)", () => {
    // The actual emission skips when total=0, so build a nonzero total.
    const out = buildStatusBarText({
      model: "m",
      tokens: { input: 1, output: 1, total: 2, costUsd: 12.5 },
    });
    expect(out).toContain("$12.5");
  });

  it("shows cache hit % when cacheRead is present", () => {
    const out = buildStatusBarText({
      model: "m",
      tokens: { input: 200, output: 100, total: 300, cacheRead: 800 },
    });
    // 800 / (200 + 800) = 80%
    expect(out).toMatch(/↻ 80%/);
  });

  it("omits cache hit % when cacheRead is zero / undefined", () => {
    const out1 = buildStatusBarText({
      model: "m",
      tokens: { input: 200, output: 100, total: 300 },
    });
    const out2 = buildStatusBarText({
      model: "m",
      tokens: { input: 200, output: 100, total: 300, cacheRead: 0 },
    });
    expect(out1).not.toContain("↻");
    expect(out2).not.toContain("↻");
  });
});
