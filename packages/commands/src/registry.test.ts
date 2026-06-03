import { describe, expect, it } from "vitest";
import { executeCommand, parseSlashCommand, listCommands } from "./registry.js";
import { M3ConfigSchema } from "@m3/config";

describe("commands", () => {
  const ctx = {
    config: M3ConfigSchema.parse({}),
    sessionKey: "agent:coder:test",
    channel: "webchat",
  };

  it("parses slash commands", () => {
    expect(parseSlashCommand("/help")).toEqual({ name: "help", args: "" });
    expect(parseSlashCommand("/model opus")).toEqual({ name: "model", args: "opus" });
    expect(parseSlashCommand("hello")).toBeNull();
  });

  it("executes help", () => {
    const result = executeCommand("help", "", ctx);
    expect(result?.action).toBe("reply_only");
    if (result?.action === "reply_only") {
      expect(result.text).toContain("/help");
    }
  });

  it("lists phase2 commands", () => {
    expect(listCommands()).toContain("mcp");
    expect(listCommands()).toContain("plan");
  });
});
