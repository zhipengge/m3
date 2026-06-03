import { describe, expect, it } from "vitest";
import { PHASE3_CHANNEL_IDS, isPhase3Channel } from "./phase3-stubs.js";

describe("phase3 channels", () => {
  it("lists 20+ channel ids", () => {
    expect(PHASE3_CHANNEL_IDS.length).toBeGreaterThanOrEqual(20);
  });

  it("detects phase3 channel", () => {
    expect(isPhase3Channel("discord")).toBe(true);
    expect(isPhase3Channel("webchat")).toBe(false);
  });
});
