import { describe, expect, it } from "vitest";
import { applyWorkspaceToMcpServers } from "./workspace-roots.js";

describe("applyWorkspaceToMcpServers", () => {
  it("replaces /tmp root with workspace", () => {
    const out = applyWorkspaceToMcpServers(
      {
        filesystem: {
          command: "node",
          args: ["server-filesystem.js", "/tmp"],
        },
      },
      "/Users/me/proj",
    );
    expect(out.filesystem?.args?.at(-1)).toBe("/Users/me/proj");
  });

  it("replaces {{WORKSPACE}} placeholder", () => {
    const out = applyWorkspaceToMcpServers(
      {
        fs: { command: "node", args: ["index.js", "{{WORKSPACE}}"] },
      },
      "/repo",
    );
    expect(out.fs?.args?.at(-1)).toBe("/repo");
  });
});
