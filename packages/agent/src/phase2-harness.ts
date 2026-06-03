import type { AgentEngine, AgentRunOptions, SubAgentSpawnOptions } from "./types.js";

/** Phase 2: sub-agent spawn via Claude Code AgentTool semantics. */
export async function spawnSubAgent(
  engine: AgentEngine,
  options: SubAgentSpawnOptions,
): Promise<{ text: string; sessionId?: string }> {
  const prompt = `[sub-agent:${options.agentType ?? "general"}] ${options.prompt}`;
  let text = "";
  let sessionId: string | undefined;
  const runOpts: AgentRunOptions = {
    prompt,
    sessionId: options.parentSessionId,
    cwd: options.cwd,
  };
  for await (const evt of engine.run(runOpts)) {
    if (evt.type === "result") {
      text = evt.text;
      sessionId = evt.sessionId;
    } else if (evt.type === "assistant_message") {
      text = evt.text;
    }
  }
  return { text, sessionId };
}

export function buildPlanModePrompt(userPrompt: string): string {
  return `[plan mode] Analyze and propose a plan before making changes.\n\n${userPrompt}`;
}

export type McpGatewayBridgeConfig = {
  port: number;
  token: string;
  enabledTools: string[];
};

/** Phase 2: MCP loopback bridge config generator (OpenClaw bundleMcp pattern). */
export function generateMcpBridgeConfig(config: McpGatewayBridgeConfig): string {
  return JSON.stringify(
    {
      mcpServers: {
        "m3-gateway": {
          type: "http",
          url: `http://127.0.0.1:${config.port}/mcp`,
          headers: { Authorization: `Bearer ${config.token}` },
        },
      },
    },
    null,
    2,
  );
}
