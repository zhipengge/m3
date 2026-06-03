#!/usr/bin/env node
/**
 * E2E: bundled hello plugin + DeepSeek calls HelloEcho tool.
 * Usage: node scripts/verify-hello-plugin.mjs
 */
import { createAgentEngine } from "../packages/agent/dist/index.js";
import { loadConfig } from "../packages/config/dist/index.js";
import { loadM3PluginsFromConfig } from "../packages/plugin-sdk/dist/index.js";

const MARKER = "m3-plugin-ok";
const m3 = loadConfig();
await loadM3PluginsFromConfig(m3);

const engine = createAgentEngine({ config: m3.agent, m3Config: m3 });

let helloToolUsed = false;
let finalText = "";

for await (const evt of engine.run({
  prompt: `Call the HelloEcho tool with text exactly "${MARKER}" and reply with only the tool output.`,
  cwd: process.cwd(),
})) {
  if (evt.type === "tool_use" && evt.name === "HelloEcho") {
    helloToolUsed = true;
    console.log(`[event] HelloEcho: ${JSON.stringify(evt.input)}`);
  }
  if (evt.type === "tool_result" && evt.name === "HelloEcho") {
    console.log(`[event] HelloEcho result: ${evt.output?.slice(0, 200)}`);
  }
  if (evt.type === "result") finalText = evt.text;
}

const echoOk = finalText.includes(`echo: ${MARKER}`) || finalText.includes(MARKER);
console.log("\n--- final answer ---\n" + finalText);
console.log("\n--- assertions ---");
console.log("HelloEcho invoked:", helloToolUsed);
console.log("Echo marker in reply:", echoOk);
process.exit(helloToolUsed && echoOk ? 0 : 1);
