import type { M3Config } from "@m3/config";

export type ParsedSlashCommand = {
  name: string;
  args: string;
};

export type CommandContext = {
  config: M3Config;
  sessionKey: string;
  channel: string;
};

export type CommandResult =
  | { action: "reply_only"; text: string }
  | { action: "inject_prompt"; prompt: string }
  | { action: "clear_session" }
  | { action: "passthrough" };

export type CommandHandler = (args: string, ctx: CommandContext) => CommandResult;

const BUILTIN_COMMANDS: Record<string, CommandHandler> = {
  help: () => ({
    action: "reply_only",
    text: [
      "m3 commands:",
      "/help — this message",
      "/status — session status",
      "/clear — clear context hint",
      "/compact — compact conversation",
      "/plan — enter plan mode",
      "/model <name> — switch model",
      "/permissions — show permission mode",
      "/mcp — MCP status",
      "/skills — skill dirs",
      "/doctor — run m3 doctor",
      "/pair <code> — approve DM pairing (when dmPolicy=pairing)",
      "/compact — compact context",
      "/clear — fresh context",
    ].join("\n"),
  }),
  status: (_args, ctx) => ({
    action: "reply_only",
    text: `Session: ${ctx.sessionKey}\nChannel: ${ctx.channel}\nEngine: ${ctx.config.agent.engine}\nModel: ${ctx.config.agent.model}`,
  }),
  clear: () => ({ action: "clear_session" }),
  compact: () => ({
    action: "inject_prompt",
    prompt: "[system] User requested /compact. Summarize and compact prior context.",
  }),
  plan: () => ({
    action: "inject_prompt",
    prompt: "[plan mode] Propose a detailed plan before making any file changes or running commands.",
  }),
  model: (args, ctx) => {
    const model = args.trim() || ctx.config.agent.model;
    return {
      action: "reply_only",
      text: `Model set to: ${model} (persist via ~/.m3/m3.json)`,
    };
  },
  permissions: (_args, ctx) => ({
    action: "reply_only",
    text: `Permission mode: ${ctx.config.agent.permissionMode}`,
  }),
};

/** Phase 2: extended CC slash command registry. */
const PHASE2_COMMANDS: Record<string, CommandHandler> = {
  mcp: (_args, ctx) => ({
    action: "reply_only",
    text: [
      "MCP tools load via agent.mcp in ~/.m3/m3.json",
      `config: ${ctx.config.agent.mcp?.config ?? "(not set)"}`,
      `prefix: ${ctx.config.agent.mcp?.toolPrefix ?? "mcp__"}`,
      "See examples/mcp.json for Claude Desktop-compatible mcpServers shape.",
    ].join("\n"),
  }),
  skills: () => ({ action: "reply_only", text: "Skills: configure via agent.skills.dirs" }),
  agents: () => ({ action: "reply_only", text: "Sub-agents enabled via agent.subAgents" }),
  hooks: () => ({ action: "reply_only", text: "Hooks: configure via hooks in m3.json" }),
  memory: () => ({ action: "reply_only", text: "Memory: uses Claude Code CLAUDE.md / memdir" }),
  review: () => ({
    action: "inject_prompt",
    prompt: "Review the recent code changes and provide feedback.",
  }),
  doctor: () => ({ action: "reply_only", text: "Run: m3 doctor" }),
  context: () => ({
    action: "reply_only",
    text: "Context: managed by native harness session store (~/.m3/transcripts).",
  }),
  cost: () => ({ action: "reply_only", text: "Cost tracking: configure model provider billing in m3.json." }),
  init: (_args, ctx) => ({
    action: "reply_only",
    text: `Workspace: ${ctx.config.agent.cwd ?? process.cwd()}\nRun m3 doctor to verify install.`,
  }),
  config: (_args, ctx) => ({
    action: "reply_only",
    text: `Config: ~/.m3/m3.json\nModel: ${ctx.config.agent.model}\nEngine: ${ctx.config.agent.engine}`,
  }),
  resume: () => ({
    action: "inject_prompt",
    prompt: "[system] User requested /resume. Continue from prior session context.",
  }),
  export: () => ({ action: "reply_only", text: "Export: transcripts under ~/.m3/transcripts/" }),
};

const ALL_COMMANDS: Record<string, CommandHandler> = {
  ...BUILTIN_COMMANDS,
  ...PHASE2_COMMANDS,
};

export function parseSlashCommand(body: string): ParsedSlashCommand | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith("/")) return null;
  const match = /^\/([\w-]+)(?:\s+(.*))?$/s.exec(trimmed);
  if (!match) return null;
  return { name: match[1]!.toLowerCase(), args: match[2]?.trim() ?? "" };
}

export function executeCommand(
  name: string,
  args: string,
  ctx: CommandContext,
): CommandResult | null {
  const handler = ALL_COMMANDS[name];
  if (!handler) return null;
  return handler(args, ctx);
}

export function listCommands(): string[] {
  return Object.keys(ALL_COMMANDS).sort();
}

export function registerCommand(name: string, handler: CommandHandler): void {
  ALL_COMMANDS[name.toLowerCase()] = handler;
}
