import { describe, expect, it } from "vitest";
import { buildPlanModePrompt, generateMcpBridgeConfig, spawnSubAgent } from "./phase2-harness.js";
import { createMockEngine } from "./mock-engine.js";
import { controlUiUrl, configureVoiceMode } from "./phase4-advanced.js";

describe("phase2 harness", () => {
  it("builds plan mode prompt", () => {
    expect(buildPlanModePrompt("fix bug")).toContain("plan");
  });

  it("generates mcp bridge config", () => {
    const json = generateMcpBridgeConfig({ port: 9999, token: "t", enabledTools: ["message"] });
    expect(json).toContain("m3-gateway");
  });

  it("spawns sub-agent via mock engine", async () => {
    const engine = createMockEngine();
    const result = await spawnSubAgent(engine, { prompt: "task", agentType: "explore" });
    expect(result.text).toContain("sub-agent");
  });
});

describe("phase4 advanced", () => {
  it("returns control ui url", () => {
    expect(controlUiUrl({ port: 18790, bind: "127.0.0.1" })).toBe("http://127.0.0.1:18790/");
  });

  it("configures voice mode", () => {
    expect(configureVoiceMode({ provider: "system" }).provider).toBe("system");
  });
});
