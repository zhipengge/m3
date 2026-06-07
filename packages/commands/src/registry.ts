import type { M3Config } from "@m3/config";
import { GoalStore } from "./goal-store.js";

export type ParsedSlashCommand = {
  name: string;
  args: string;
};

export type CommandContext = {
  config: M3Config;
  sessionKey: string;
  channel: string;
  /** Active harness session id (transcript file). */
  claudeSessionId?: string;
  /** Message count in current transcript. */
  messageCount?: number;
  /** Estimated context fill ratio 0–1+. */
  contextUsageRatio?: number;
  goalStore?: GoalStore;
};

export type CommandResult =
  | { action: "reply_only"; text: string }
  | { action: "inject_prompt"; prompt: string }
  | { action: "clear_session"; hard?: boolean }
  | { action: "clear_undo" }
  | { action: "compact_session"; focus?: string }
  | { action: "set_goal"; condition: string }
  | { action: "passthrough" };

export type CommandHandler = (args: string, ctx: CommandContext) => CommandResult;

const GOAL_CLEAR_RE = /^(clear|stop|off|reset|none|cancel)$/i;

function formatContextUsage(ctx: CommandContext): string {
  const ratio = ctx.contextUsageRatio;
  const pct = ratio !== undefined ? `${Math.min(100, Math.round(ratio * 100))}%` : "unknown";
  const auto = ratio !== undefined && ratio >= 0.9 ? " (auto-compress at 90%)" : "";
  return [
    `Session: ${ctx.sessionKey}`,
    `Channel: ${ctx.channel}`,
    `Engine: ${ctx.config.agent.engine}`,
    `Model: ${ctx.config.agent.model}`,
    `Messages in transcript: ${ctx.messageCount ?? 0}`,
    `Context usage: ~${pct}${auto}`,
  ].join("\n");
}

const BUILTIN_COMMANDS: Record<string, CommandHandler> = {
  thinking: (args) => {
    const arg = args.trim().toLowerCase();
    const mode =
      !arg || arg === "toggle"
        ? "toggle"
        : arg === "expand" || arg === "on"
          ? "expand"
          : arg === "collapse" || arg === "off"
            ? "collapse"
            : null;
    if (!mode) {
      return {
        action: "reply_only",
        text: "Usage: /thinking [toggle|expand|collapse]. In Ink REPL use Ctrl+O.",
      };
    }
    return {
      action: "reply_only",
      text:
        mode === "expand"
          ? "Thinking display: expanded (Ink REPL: Ctrl+O to collapse)"
          : mode === "collapse"
            ? "Thinking display: collapsed (Ink REPL: Ctrl+O to expand)"
            : "Thinking display toggled (Ink REPL: Ctrl+O)",
    };
  },
  help: () => ({
    action: "reply_only",
    text: [
      "m3 slash commands (Claude Code–style):",
      "/help — this message",
      "/thinking [toggle|expand|collapse] — show/hide reasoning (Ctrl+O in Ink REPL)",
      "/status — session + model",
      "/context — context window usage",
      "/clear — clear session (aliases: /reset, /new)",
      "/compact [focus] — compress conversation history",
      "/goal [condition|clear] — set or clear a session goal",
      "/plan — plan mode prompt",
      "/model <ref> — show model ref",
      "/permissions — permission mode",
      "/doctor — run m3 doctor",
      "/mcp · /skills · /agents · /hooks · /memory · /review · /config · /resume · /export · /init · /cost",
    ].join("\n"),
  }),
  status: (_args, ctx) => ({
    action: "reply_only",
    text: formatContextUsage(ctx),
  }),
  context: (_args, ctx) => ({
    action: "reply_only",
    text: formatContextUsage(ctx),
  }),
  clear: (args) => {
    const arg = args.trim().toLowerCase();
    if (arg === "undo") {
      return { action: "clear_undo" };
    }
    if (arg === "hard" || arg === "--hard") {
      // Force the legacy unlink semantics. Default is now soft-delete
      // (archive + /clear undo) so accidental /clear isn't fatal.
      return { action: "clear_session", hard: true };
    }
    return { action: "clear_session" };
  },
  reset: (args) => {
    const arg = args.trim().toLowerCase();
    if (arg === "undo") return { action: "clear_undo" };
    return { action: "clear_session" };
  },
  new: () => ({ action: "clear_session" }),
  compact: (args) => ({
    action: "compact_session",
    focus: args.trim() || undefined,
  }),
  goal: (args, ctx) => {
    const store = ctx.goalStore ?? new GoalStore();
    const trimmed = args.trim();
    if (!trimmed) {
      const active = store.get(ctx.sessionKey);
      if (!active) {
        return {
          action: "reply_only",
          text: "No active goal. Usage: /goal <completion condition>  e.g. /goal all tests pass",
        };
      }
      return {
        action: "reply_only",
        text: `Active goal: ${active.condition}\nTurns: ${active.turns}\nClear: /goal clear`,
      };
    }
    if (GOAL_CLEAR_RE.test(trimmed)) {
      const cleared = store.clear(ctx.sessionKey);
      return {
        action: "reply_only",
        text: cleared ? "Goal cleared." : "No active goal.",
      };
    }
    store.set(ctx.sessionKey, trimmed);
    return {
      action: "set_goal",
      condition: trimmed,
    };
  },
  plan: () => ({
    action: "inject_prompt",
    prompt: "[plan mode] Propose a detailed plan before making any file changes or running commands.",
  }),
  model: (args, ctx) => {
    const query = args.trim();
    if (!query) {
      return {
        action: "reply_only",
        text: `Active model: ${ctx.config.agent.model}\nList: m3 models\nSwitch: m3 model <ref>`,
      };
    }
    return {
      action: "reply_only",
      text: `To switch model, run in terminal:\n  m3 model ${query}\n\n(/model in chat does not write m3.json)`,
    };
  },
  permissions: (_args, ctx) => ({
    action: "reply_only",
    text: `Permission mode: ${ctx.config.agent.permissionMode}\nChannel inbound: ${ctx.config.agent.channelPermissionMode ?? "bypassPermissions"}`,
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
  memory: () => ({ action: "reply_only", text: "Memory: uses CLAUDE.md / project memory files" }),
  review: () => ({
    action: "inject_prompt",
    prompt: "Review the recent code changes and provide feedback.",
  }),
  doctor: () => ({ action: "reply_only", text: "Run: m3 doctor" }),
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

export { GoalStore } from "./goal-store.js";
