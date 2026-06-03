import { describe, expect, it } from "vitest";
import { PermissionBridge } from "./permission-bridge.js";

describe("PermissionBridge workspace grant", () => {
  it("auto-approves Write after grantWorkspace", async () => {
    const bridge = new PermissionBridge({ permissionMode: "default" } as never);
    bridge.grantWorkspace("/tmp/proj");
    const decision = await bridge.requestApproval({
      toolName: "Write",
      description: "Write: index.html",
      sessionKey: "s1",
      workspaceRoot: "/tmp/proj",
    });
    expect(decision).toBe("approve");
  });

  it("denies Write without workspace grant", async () => {
    const bridge = new PermissionBridge({ permissionMode: "default" } as never);
    const decision = await bridge.requestApproval({
      toolName: "Write",
      description: "Write: index.html",
      sessionKey: "s1",
      workspaceRoot: "/tmp/proj",
    });
    expect(decision).toBe("deny");
  });
});
