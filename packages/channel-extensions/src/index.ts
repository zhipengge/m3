import { registerChannel } from "@m3/channels";
import { feishuPlugin } from "./feishu.js";
import { slackPlugin } from "./slack.js";
import { webchatPlugin } from "./webchat.js";

export * from "./webchat.js";
export * from "./slack.js";
export * from "./feishu.js";
export * from "./media/store.js";
export * from "./feishu/inbound.js";
export * from "./feishu/react.js";
export * from "./slack/inbound.js";
export * from "./phase3-stubs.js";

export function registerBundledChannels(): void {
  registerChannel(webchatPlugin);
  registerChannel(slackPlugin);
  registerChannel(feishuPlugin);
}
