import { describe, expect, it } from "vitest";
import { createMockEngine } from "@m3/agent";
import { registerBundledChannels, registerWebChatClient, simulateWebChatInbound } from "@m3/channel-extensions";
import { getChannelPlugin } from "@m3/channels";
import { M3ConfigSchema } from "@m3/config";
import { PermissionBridge } from "./permission-bridge.js";
import { createMessagePipeline } from "./pipeline.js";
import { SessionMapper } from "./session-mapper.js";

describe("E2E pipeline", () => {
  it("webchat message -> mock agent -> reply", async () => {
    registerBundledChannels();
    const config = M3ConfigSchema.parse({});
    const replies: string[] = [];

    registerWebChatClient("test-peer", (text) => replies.push(text));

    const engine = createMockEngine((p) => `Echo: ${p}`);
    const sessionMapper = new SessionMapper("/tmp/m3-test-sessions-e2e.json");
    const permissionBridge = new PermissionBridge(config.agent);

    const pipeline = createMessagePipeline({
      config,
      engine,
      sessionMapper,
      permissionBridge,
      mock: true,
    });

    getChannelPlugin("webchat");
    const runtime = {
      config,
      log: () => {},
      onInbound: (msg: import("@m3/channels").InboundMessage) => pipeline.handleInbound(msg),
    };

    await simulateWebChatInbound(runtime, "test-peer", "hello m3");
    expect(replies.some((r) => r.includes("Echo: hello m3"))).toBe(true);
  });
});
