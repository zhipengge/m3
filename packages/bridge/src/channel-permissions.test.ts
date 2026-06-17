import { describe, expect, it } from "vitest";
import { agentConfigForChannel, resolveChannelPermissionMode } from "./channel-permissions.js";

describe("channel permissions", () => {
  it("defaults to 'default' (gated) for channels — safer than bypassPermissions", () => {
    expect(resolveChannelPermissionMode({ permissionMode: "default" } as never)).toBe(
      "default",
    );
  });

  it("honors channelPermissionMode override", () => {
    expect(
      resolveChannelPermissionMode({
        permissionMode: "default",
        channelPermissionMode: "plan",
      } as never),
    ).toBe("plan");
  });

  it("operator can still opt in to bypassPermissions", () => {
    expect(
      resolveChannelPermissionMode({
        permissionMode: "default",
        channelPermissionMode: "bypassPermissions",
      } as never),
    ).toBe("bypassPermissions");
  });

  it("agentConfigForChannel applies channel mode", () => {
    const out = agentConfigForChannel({ permissionMode: "default" } as never);
    expect(out.permissionMode).toBe("default");
  });

  it("terminal REPL keeps agent.permissionMode", () => {
    const out = agentConfigForChannel({ permissionMode: "default" } as never, {
      channelId: "webchat",
      peerId: "terminal",
    });
    expect(out.permissionMode).toBe("default");
  });
});
