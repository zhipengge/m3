import { executeCommand, parseSlashCommand, type CommandResult } from "@m3/commands";
import type { M3Config } from "@m3/config";

export type CommandBridgeContext = {
  config: M3Config;
  sessionKey: string;
  channel: string;
  claudeSessionId?: string;
  messageCount?: number;
  contextUsageRatio?: number;
};

export class CommandBridge {
  constructor(private readonly ctx: CommandBridgeContext) {}

  tryHandle(body: string): CommandResult | null {
    const parsed = parseSlashCommand(body);
    if (!parsed) return null;
    return executeCommand(parsed.name, parsed.args, {
      config: this.ctx.config,
      sessionKey: this.ctx.sessionKey,
      channel: this.ctx.channel,
      claudeSessionId: this.ctx.claudeSessionId,
      messageCount: this.ctx.messageCount,
      contextUsageRatio: this.ctx.contextUsageRatio,
    });
  }
}

export function applyCommandResult(
  result: CommandResult,
  originalBody: string,
  opts?: { persistModel?: (model: string) => Promise<string> | string },
): string {
  if (result.action === "inject_prompt") {
    return result.prompt;
  }
  if (result.action === "set_goal") {
    return [
      `[goal] Work toward this completion condition until it is satisfied: ${result.condition}`,
      "When fully done, say GOAL_MET in your reply.",
    ].join("\n");
  }
  if (result.action === "set_model") {
    // B6 + D4: the caller (pipeline) supplies a persistModel
    // callback that knows the workspace id. We do the persist
    // here so the call site stays simple; the pipeline's
    // reply-only path is the "next session will use …" string.
    // For set_model, we want the reply to be a system message
    // surfaced to the user, so we return null and the pipeline
    // builds its own. We just persist.
    if (opts?.persistModel) {
      void opts.persistModel(result.model);
    }
    return ""; // pipeline handles the user-facing message
  }
  if (result.action === "reply_only") {
    return result.text;
  }
  if (result.action === "passthrough") {
    return originalBody;
  }
  return originalBody;
}

export function isReplyOnlyCommand(result: CommandResult): boolean {
  return result.action === "reply_only";
}

export function isClearSessionCommand(
  result: CommandResult,
): result is Extract<CommandResult, { action: "clear_session" }> {
  return result.action === "clear_session";
}

export function isClearUndoCommand(
  result: CommandResult,
): result is Extract<CommandResult, { action: "clear_undo" }> {
  return result.action === "clear_undo";
}

export function isMemoryCommand(
  result: CommandResult,
): result is Extract<CommandResult, { action: "memory" }> {
  return result.action === "memory";
}

export function isCompactSessionCommand(result: CommandResult): boolean {
  return result.action === "compact_session";
}

export function isSetGoalCommand(result: CommandResult): boolean {
  return result.action === "set_goal";
}
