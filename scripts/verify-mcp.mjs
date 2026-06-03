#!/usr/bin/env node
/**
 * MCP integration check.
 *   node scripts/verify-mcp.mjs              — validate ~/.m3/mcp.json
 *   node scripts/verify-mcp.mjs --connect    — spawn servers + list tools
 *   node scripts/verify-mcp.mjs --live       — DeepSeek agent calls MCP tool
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { copyFile, mkdir } from "node:fs/promises";
import { createAgentEngine, loadMcpConfig, mergeMcpServers } from "../packages/agent/dist/index.js";
import { expandHome, loadConfig } from "../packages/config/dist/index.js";
import { collectTools } from "../packages/agent/dist/tools/tool-source.js";
import { connectMcpServer, listAllMcpTools } from "../packages/agent/dist/mcp/pool.js";
import { resetMcpPool } from "../packages/agent/dist/mcp/provider.js";

const CONNECT = process.argv.includes("--connect");
const LIVE = process.argv.includes("--live");
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const M3_HOME = path.join(homedir(), ".m3");
const MCP_PATH = path.join(M3_HOME, "mcp.json");

async function ensureMcpConfig() {
  await mkdir(M3_HOME, { recursive: true });
  if (!fs.existsSync(MCP_PATH)) {
    const example = path.join(REPO_ROOT, "examples/mcp.json");
    let raw = await fs.promises.readFile(example, "utf8");
    raw = raw.replace('"cwd": "."', `"cwd": ${JSON.stringify(REPO_ROOT)}`);
    await fs.promises.writeFile(MCP_PATH, raw);
    console.log(`[setup] created ${MCP_PATH} (cwd → repo root)`);
  }
}

function resolveMcpEntries(agentConfig) {
  const configPath = agentConfig.mcp?.config ?? MCP_PATH;
  const fromFile = loadMcpConfig(configPath);
  const merged = mergeMcpServers(fromFile, agentConfig.mcp?.servers);
  for (const entry of Object.values(merged)) {
    if (entry.cwd === ".") entry.cwd = REPO_ROOT;
  }
  return { configPath: expandHome(configPath), merged };
}

async function pingMcpServers(agentConfig) {
  const { merged } = resolveMcpEntries(agentConfig);
  const names = Object.keys(merged);
  if (names.length === 0) {
    console.error("No MCP servers configured");
    return false;
  }

  await resetMcpPool();
  let ok = true;
  for (const [id, entry] of Object.entries(merged)) {
    try {
      const server = await connectMcpServer(id, entry);
      const tools = await listAllMcpTools([server]);
      console.log(`[mcp] ${id}: connected, ${tools.length} tool(s)`);
      tools.slice(0, 5).forEach((t) => console.log(`       - ${t.name}`));
      if (tools.length > 5) console.log(`       ... +${tools.length - 5} more`);
      await server.close();
    } catch (err) {
      ok = false;
      console.error(`[mcp] ${id}: FAILED — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return ok;
}

async function liveAgentMcp(agentConfig, m3Config) {
  const { tools } = await collectTools(agentConfig);
  const prefix = agentConfig.mcp?.toolPrefix ?? "mcp__";
  const mcpTools = tools.filter((t) => t.name.startsWith(prefix));
  if (mcpTools.length === 0) {
    console.error("No MCP tools in harness (collectTools)");
    return false;
  }
  console.log(`[live] MCP tools: ${mcpTools.map((t) => t.name).slice(0, 6).join(", ")}${mcpTools.length > 6 ? "..." : ""}`);

  const engine = createAgentEngine({
    config: { ...agentConfig, permissionMode: "bypassPermissions" },
    m3Config,
  });
  let mcpToolUsed = false;
  let finalText = "";

  for await (const evt of engine.run({
    prompt:
      "List files in /tmp using an MCP filesystem tool. " +
      "Reply with one line starting with MCP-LIVE-OK and include one filename, or MCP-LIVE-FAIL.",
    cwd: process.cwd(),
  })) {
    if (evt.type === "tool_use" && evt.name.startsWith(prefix)) {
      mcpToolUsed = true;
      console.log(`[event] ${evt.name}`);
    }
    if (evt.type === "result") finalText = evt.text;
  }

  console.log("\n--- final answer ---\n" + finalText);
  const ok = mcpToolUsed && finalText.includes("MCP-LIVE-OK");
  console.log("MCP tool invoked:", mcpToolUsed);
  console.log("MCP-LIVE-OK:", finalText.includes("MCP-LIVE-OK"));
  return ok;
}

await ensureMcpConfig();

const m3 = loadConfig();
const agent = {
  ...m3.agent,
  mcp: {
    ...m3.agent.mcp,
    config: m3.agent.mcp?.config ?? expandHome("~/.m3/mcp.json"),
    toolPrefix: m3.agent.mcp?.toolPrefix ?? "mcp__",
  },
};

const { configPath, merged } = resolveMcpEntries(agent);
console.log(`MCP config: ${configPath}`);
console.log(`Servers: ${Object.keys(merged).join(", ") || "(none)"}`);

if (!CONNECT && !LIVE) {
  console.log("\nConfig OK. Use --connect to spawn servers, --live for DeepSeek e2e.");
  process.exit(Object.keys(merged).length > 0 ? 0 : 1);
}

const pingOk = await pingMcpServers(agent);
if (!pingOk) process.exit(1);

if (!LIVE) {
  console.log("\nMCP connect OK.");
  process.exit(0);
}

const liveOk = await liveAgentMcp(agent, m3);
process.exit(liveOk ? 0 : 1);
