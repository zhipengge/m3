import { describe, expect, it } from "vitest";
import { PermissionManager } from "./manager.js";

describe("PermissionManager", () => {
  it("allows non-Bash tools in default mode without handler (channel/gateway)", async () => {
    const pm = new PermissionManager("default");
    expect(
      await pm.canUseTool({
        toolName: "Write",
        isReadOnly: false,
        needsPermission: true,
        description: "write file",
      }),
    ).toBe("allow");
  });

  it("denies Bash in default mode without handler", async () => {
    const pm = new PermissionManager("default");
    expect(
      await pm.canUseTool({
        toolName: "Bash",
        isReadOnly: false,
        needsPermission: true,
        description: "run cmd",
      }),
    ).toBe("deny");
  });

  it("bypasses in bypassPermissions mode", async () => {
    const pm = new PermissionManager("bypassPermissions");
    expect(
      await pm.canUseTool({
        toolName: "Bash",
        isReadOnly: false,
        needsPermission: true,
        description: "test",
      }),
    ).toBe("allow");
  });

  it("denies writes in plan mode", async () => {
    const pm = new PermissionManager("plan");
    expect(
      await pm.canUseTool({
        toolName: "Write",
        isReadOnly: false,
        needsPermission: true,
        description: "test",
      }),
    ).toBe("deny");
  });

  it("allows reads in plan mode", async () => {
    const pm = new PermissionManager("plan");
    expect(
      await pm.canUseTool({
        toolName: "Read",
        isReadOnly: true,
        needsPermission: false,
        description: "test",
      }),
    ).toBe("allow");
  });
});
