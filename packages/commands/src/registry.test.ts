import { describe, expect, it } from "vitest";
import { executeCommand, parseSlashCommand, listCommands } from "./registry.js";
import { GoalStore } from "./goal-store.js";
import { M3ConfigSchema } from "@m3/config";

describe("commands", () => {
  const ctx = {
    config: M3ConfigSchema.parse({}),
    sessionKey: "agent:coder:test",
    channel: "webchat",
    messageCount: 12,
    contextUsageRatio: 0.42,
  };

  it("parses slash commands", () => {
    expect(parseSlashCommand("/help")).toEqual({ name: "help", args: "" });
    expect(parseSlashCommand("/model opus")).toEqual({ name: "model", args: "opus" });
    expect(parseSlashCommand("/goal tests pass")).toEqual({ name: "goal", args: "tests pass" });
    expect(parseSlashCommand("hello")).toBeNull();
  });

  it("executes help", () => {
    const result = executeCommand("help", "", ctx);
    expect(result?.action).toBe("reply_only");
    if (result?.action === "reply_only") {
      expect(result.text).toContain("/goal");
      expect(result.text).toContain("/compact");
    }
  });

  it("lists phase2 commands", () => {
    expect(listCommands()).toContain("mcp");
    expect(listCommands()).toContain("plan");
    expect(listCommands()).toContain("goal");
    expect(listCommands()).toContain("reset");
  });

  it("/goal sets and clears", () => {
    const store = new GoalStore(`~/.m3/test-goals-${Date.now()}.json`);
    const withStore = { ...ctx, goalStore: store };
    const set = executeCommand("goal", "all tests green", withStore);
    expect(set?.action).toBe("set_goal");
    const show = executeCommand("goal", "", withStore);
    expect(show?.action).toBe("reply_only");
    if (show?.action === "reply_only") expect(show.text).toContain("all tests green");
    const cleared = executeCommand("goal", "clear", withStore);
    expect(cleared?.action).toBe("reply_only");
  });

  it("/compact returns compact_session", () => {
    const result = executeCommand("compact", "focus on API", ctx);
    expect(result?.action).toBe("compact_session");
    if (result?.action === "compact_session") {
      expect(result.focus).toBe("focus on API");
    }
  });

  it("/reset aliases clear", () => {
    expect(executeCommand("reset", "", ctx)?.action).toBe("clear_session");
    expect(executeCommand("new", "", ctx)?.action).toBe("clear_session");
  });

  it("/context shows usage", () => {
    const result = executeCommand("context", "", ctx);
    expect(result?.action).toBe("reply_only");
    if (result?.action === "reply_only") {
      expect(result.text).toContain("42%");
    }
  });
});
