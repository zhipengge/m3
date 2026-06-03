import { executeCommand, parseSlashCommand, type CommandResult } from "@m3/commands";
import type { M3Config } from "@m3/config";

export type CommandBridgeContext = {
  config: M3Config;
  sessionKey: string;
  channel: string;
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
    });
  }
}

export function applyCommandResult(result: CommandResult, originalBody: string): string {
  if (result.action === "inject_prompt") {
    return result.prompt;
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

export function isClearSessionCommand(result: CommandResult): boolean {
  return result.action === "clear_session";
}
