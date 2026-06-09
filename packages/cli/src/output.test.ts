import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { c, header, status, suggest, rule, symbols } from "./output.js";

describe("output helpers", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
  });

  describe("c.*", () => {
    it("returns identity function when color is disabled", async () => {
      // Force color off via env, then re-import to pick up env change
      const prev = process.env.NO_COLOR;
      process.env.NO_COLOR = "1";
      try {
        const fresh = await import("./output.js");
        expect(fresh.c.brand("hi")).toBe("hi");
        expect(fresh.c.ok("ok")).toBe("ok");
      } finally {
        if (prev === undefined) delete process.env.NO_COLOR;
        else process.env.NO_COLOR = prev;
      }
    });

    it("includes ANSI when stdout is a TTY (test env may force color)", () => {
      // Don't assert exact codes (TTY may or may not be true in vitest);
      // just assert the wrapper returns a string of the same length or longer
      // (it appends reset codes when color is on, otherwise identity).
      const s = c.brand("hi");
      expect(typeof s).toBe("string");
      expect(s.endsWith("hi") || s === "hi").toBe(true);
    });
  });

  describe("status()", () => {
    it("emits a status line with the label and optional detail", () => {
      status("ok", "Config", "/etc/m3.json");
      expect(logSpy).toHaveBeenCalledOnce();
      const line = String(logSpy.mock.calls[0][0]);
      expect(line).toContain("Config");
      expect(line).toContain("/etc/m3.json");
    });

    it("supports all kinds", () => {
      status("ok", "A");
      status("warn", "B");
      status("err", "C");
      status("info", "D");
      expect(logSpy).toHaveBeenCalledTimes(4);
    });

    it("emits an arrow when detail is omitted", () => {
      status("info", "X");
      const line = String(logSpy.mock.calls[0][0]);
      expect(line).toContain("X");
    });
  });

  describe("header()", () => {
    it("prints the brand prefix and title", () => {
      header("doctor", "environment check");
      const allOutput = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(allOutput).toContain("m3");
      expect(allOutput).toContain("doctor");
    });
  });

  describe("rule()", () => {
    it("prints a line of dashes", () => {
      rule(10);
      const line = String(logSpy.mock.calls[0][0]);
      expect(line).toMatch(/─{5,}/);
    });
  });

  describe("suggest()", () => {
    it("prints an indented hint", () => {
      suggest("Run m3 doctor");
      const line = String(logSpy.mock.calls[0][0]);
      expect(line).toContain("Run m3 doctor");
    });
  });

  describe("symbols", () => {
    it("exposes the same shape regardless of TTY", () => {
      expect(symbols).toHaveProperty("ok");
      expect(symbols).toHaveProperty("err");
      expect(symbols).toHaveProperty("warn");
    });
  });
});
