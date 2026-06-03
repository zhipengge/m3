import { describe, expect, it } from "vitest";
import { renderProgressBar } from "./progress.js";

describe("renderProgressBar", () => {
  it("renders empty bar at 0%", () => {
    expect(renderProgressBar(0, 10)).toBe("[----------]");
  });

  it("renders full bar at 100%", () => {
    expect(renderProgressBar(1, 10)).toBe("[==========]");
  });

  it("renders partial fill", () => {
    expect(renderProgressBar(0.5, 10)).toBe("[=====-----]");
  });
});
