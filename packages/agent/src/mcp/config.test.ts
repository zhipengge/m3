import { describe, expect, it } from "vitest";
import { mergeMcpServers, McpServerEntrySchema } from "./config.js";

describe("mcp config", () => {
  it("parses stdio and remote entries", () => {
    const stdio = McpServerEntrySchema.parse({
      command: "npx",
      args: ["-y", "some-mcp"],
    });
    expect(stdio.command).toBe("npx");

    const remote = McpServerEntrySchema.parse({
      url: "http://127.0.0.1:3000/sse",
      headers: { Authorization: "Bearer x" },
    });
    expect(remote.url).toContain("127.0.0.1");
  });

  it("merges inline over file entries", () => {
    const merged = mergeMcpServers(
      { a: { command: "node", args: ["a.js"] } },
      { b: { url: "http://localhost/mcp" } },
    );
    expect(Object.keys(merged).sort()).toEqual(["a", "b"]);
  });
});
