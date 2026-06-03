import { describe, expect, it } from "vitest";
import { buildSessionKey, resolveAgentRoute } from "./routing.js";
import { M3ConfigSchema } from "@m3/config";

describe("routing", () => {
  const config = M3ConfigSchema.parse({
    bindings: [{ channel: "feishu", peer: "ou_abc", agent: "coder", workspace: "/tmp/proj" }],
  });

  it("builds session key", () => {
    expect(
      buildSessionKey({
        agentId: "coder",
        channel: "feishu",
        accountId: "default",
        peerId: "ou_abc",
      }),
    ).toBe("agent:coder:ou_abc");
  });

  it("resolves binding route", () => {
    const route = resolveAgentRoute({
      config,
      channel: "feishu",
      accountId: "default",
      peerId: "ou_abc",
      peerKind: "dm",
    });
    expect(route.agentId).toBe("coder");
    expect(route.workspace).toBe("/tmp/proj");
    expect(route.matchedBy).toBe("binding.peer");
  });

  it("falls back to default agent", () => {
    const route = resolveAgentRoute({
      config,
      channel: "slack",
      accountId: "default",
      peerId: "U123",
      peerKind: "dm",
    });
    expect(route.agentId).toBe("coder");
    expect(route.matchedBy).toBe("default");
  });
});
