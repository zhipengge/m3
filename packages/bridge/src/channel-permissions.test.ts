import { describe, expect, it } from "vitest";
import { agentConfigForChannel, resolveChannelPermissionMode } from "./channel-permissions.js";

describe("channel permissions", () => {
  it("defaults to bypassPermissions for channels", () => {
    expect(resolveChannelPermissionMode({ permissionMode: "default" } as never)).toBe(
      "bypassPermissions",
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

  it("agentConfigForChannel applies channel mode", () => {
    const out = agentConfigForChannel({ permissionMode: "default" } as never);
    expect(out.permissionMode).toBe("bypassPermissions");
  });
});
