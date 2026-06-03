#!/usr/bin/env node
/** Quick webchat pipeline smoke test (non-interactive). */
import { createMockEngine } from "../packages/agent/dist/index.js";
import { createMessagePipeline, PermissionBridge, SessionMapper } from "../packages/bridge/dist/index.js";
import { registerBundledChannels, registerWebChatClient, simulateWebChatInbound } from "../packages/channel-extensions/dist/index.js";
import { getChannelPlugin } from "../packages/channels/dist/index.js";
import { loadConfig } from "../packages/config/dist/index.js";

registerBundledChannels();
const config = loadConfig();
const replies = [];
registerWebChatClient("verify-peer", (text) => replies.push(text));

const engine = createMockEngine((p) => `Echo: ${p}`);
const pipeline = createMessagePipeline({
  config,
  engine,
  sessionMapper: new SessionMapper("/tmp/m3-verify-webchat-sessions.json"),
  permissionBridge: new PermissionBridge(config.agent),
  mock: true,
});

getChannelPlugin("webchat");
const runtime = {
  config,
  log: () => {},
  onInbound: (msg) => pipeline.handleInbound(msg),
};

await simulateWebChatInbound(runtime, "verify-peer", "hello webchat");
const ok = replies.some((r) => r.includes("Echo: hello webchat"));
console.log(ok ? "PASS webchat pipeline" : "FAIL webchat pipeline");
process.exit(ok ? 0 : 1);
