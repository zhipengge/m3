import type { AgentEngine } from "@m3/agent";
import {
  SessionMessageStore,
  compressConversationHistory,
  estimateContextUsageRatio,
} from "@m3/agent";
import {
  feishuReactToMessage,
  pushWebChatDelta,
  pushWebChatReasoningDelta,
  pushWebChatSystem,
  pushWebChatTokens,
  pushWebChatToolResult,
  pushWebChatToolUse,
} from "@m3/channel-extensions";
import {
  createReplyDispatcher,
  finalizeInboundContext,
  getChannelPlugin,
  resolveAgentRoute,
  type InboundMessage,
} from "@m3/channels";
import type { M3Config } from "@m3/config";
import { loadSecrets, resolveAgentWorkspace, resolveModel } from "@m3/config";
import { GoalStore, parseSlashCommand } from "@m3/commands";
import {
  applyCommandResult,
  CommandBridge,
  isClearSessionCommand,
  isClearUndoCommand,
  isCompactSessionCommand,
  isMemoryCommand,
  isReplyOnlyCommand,
} from "./command-bridge.js";
import { agentConfigForChannel } from "./channel-permissions.js";
import { PairingStore } from "./pairing-store.js";
import { createPermissionHandler } from "./permission-handler.js";
import type { PermissionBridge } from "./permission-bridge.js";
import { inboundToPrompt, SessionMapper } from "./session-mapper.js";
import { SessionLock } from "./session-lock.js";
import { StreamAdapter } from "./stream-adapter.js";

export type MessagePipelineOptions = {
  config: M3Config;
  engine: AgentEngine;
  sessionMapper: SessionMapper;
  permissionBridge: PermissionBridge;
  pairingStore?: PairingStore;
  sessionLock?: SessionLock;
  onLog?: (level: "info" | "warn" | "error", message: string) => void;
  mock?: boolean;
};

function getDmPolicy(
  config: M3Config,
  channelId: string,
  accountId: string,
): "pairing" | "open" | "closed" | undefined {
  const ch = config.channels[channelId as keyof typeof config.channels];
  if (!ch || typeof ch !== "object") return undefined;
  const acc = (ch as Record<string, { dmPolicy?: string }>)[accountId];
  return acc?.dmPolicy as "pairing" | "open" | "closed" | undefined;
}

function isSenderAllowed(
  config: M3Config,
  channelId: string,
  accountId: string,
  peerId: string,
): boolean {
  const ch = config.channels[channelId as keyof typeof config.channels];
  if (!ch || typeof ch !== "object") return false;
  const acc = (ch as Record<string, { allowFrom?: string[] }>)[accountId];
  const allow = acc?.allowFrom ?? [];
  return allow.includes("*") || allow.includes(peerId);
}

export class MessagePipeline {
  private readonly pairingStore: PairingStore;
  private readonly sessionLock: SessionLock;
  /**
   * C1: resolve account-scoped provider config (provider ref +
   * localOnly flag) for a given (channel, account) pair. Returns
   * the defaults (no provider, not localOnly) when the channel or
   * account isn't in m3.json.
   */
  private accountProviderConfig(
    channelId: string,
    accountId: string,
  ): { provider?: string; localOnly: boolean } {
    const ch = (this.options.config.channels as Record<string, unknown>)[channelId] as
      | Record<string, { provider?: string; localOnly?: boolean }>
      | undefined;
    if (!ch) return { localOnly: false };
    const acc = ch[accountId];
    if (!acc) return { localOnly: false };
    return {
      provider: acc.provider,
      localOnly: Boolean(acc.localOnly),
    };
  }

  private readonly transcriptStore = new SessionMessageStore();
  private readonly goalStore = new GoalStore();

  constructor(private readonly options: MessagePipelineOptions) {
    this.pairingStore = options.pairingStore ?? new PairingStore();
    this.sessionLock = options.sessionLock ?? new SessionLock();
  }

  private log(level: "info" | "warn" | "error", message: string): void {
    this.options.onLog?.(level, message);
    if (level === "error") {
      process.stderr.write(`[m3:pipeline] ${message}\n`);
    }
  }

  async handleInbound(message: InboundMessage): Promise<void> {
    const finalized = finalizeInboundContext(message);
    const route = resolveAgentRoute({
      config: this.options.config,
      channel: finalized.channelId,
      accountId: finalized.accountId,
      peerId: finalized.peerId,
      peerKind: finalized.peerKind,
    });

    await this.sessionLock.run(route.sessionKey, async () => {
      await this.handleInboundLocked(finalized, route);
    });
  }

  private async handleInboundLocked(
    finalized: InboundMessage,
    route: ReturnType<typeof resolveAgentRoute>,
  ): Promise<void> {
    const plugin = getChannelPlugin(finalized.channelId);
    if (!plugin) {
      throw new Error(`Unknown channel: ${finalized.channelId}`);
    }

    const dispatcher = createReplyDispatcher(plugin, finalized);

    try {
      const dmPolicy = getDmPolicy(
        this.options.config,
        finalized.channelId,
        finalized.accountId,
      );
      if (
        dmPolicy === "pairing" &&
        !isSenderAllowed(
          this.options.config,
          finalized.channelId,
          finalized.accountId,
          finalized.peerId,
        ) &&
        !this.pairingStore.isApproved(
          finalized.channelId,
          finalized.accountId,
          finalized.peerId,
        )
      ) {
        const parsed = parseSlashCommand(finalized.body);
        if (parsed?.name === "pair" && parsed.args) {
          const ok = this.pairingStore.approve(
            finalized.channelId,
            finalized.accountId,
            finalized.peerId,
            parsed.args,
          );
          await dispatcher.deliver({
            text: ok
              ? "Pairing successful. You can start chatting."
              : "Invalid pairing code. Please try again.",
          });
          return;
        }
        const rec = this.pairingStore.getOrCreate(
          finalized.channelId,
          finalized.accountId,
          finalized.peerId,
        );
        await dispatcher.deliver({
          text: `Not paired. Send: /pair ${rec.code}`,
        });
        this.log("info", `pairing required ${finalized.channelId}:${finalized.peerId}`);
        return;
      }

      if (plugin.security) {
        const allowed = await plugin.security.isAllowedSender({
          config: this.options.config,
          accountId: finalized.accountId,
          peerId: finalized.peerId,
        });
        if (!allowed) {
          this.log("warn", `sender blocked ${finalized.channelId}:${finalized.peerId}`);
          return;
        }
      }

      try {
        await dispatcher.startTyping?.();
      } catch {
        // best-effort ack
      }

      const mapping = this.options.sessionMapper.get(route.sessionKey);
      const priorMessages = mapping?.claudeSessionId
        ? this.transcriptStore.load(mapping.claudeSessionId)
        : [];
      let contextUsageRatio: number | undefined;
      try {
        const secrets = loadSecrets();
        // C1: account-scoped provider override. If this
        // (channel, accountId) pair has a `provider` set in
        // m3.json, use that as the model ref instead of the
        // global `agent.model`. Combined with `localOnly: true`,
        // this is the privacy-mode-channel primitive: a
        // customer-support Feishu account can be pinned to a
        // local model with a hard guard against cloud fallback.
        const accountConfig = this.accountProviderConfig(
          finalized.channelId,
          finalized.accountId,
        );
        const modelRef = accountConfig.provider ?? this.options.config.agent.model;
        const resolved = resolveModel(this.options.config, secrets, modelRef);
        if (accountConfig.localOnly && !resolved.api.startsWith("local/")) {
          // Guard: refuse to use a non-local provider when the
          // account is flagged localOnly. Surfaces in the reply
          // so a misconfigured account doesn't silently degrade
          // to a cloud LLM.
          await dispatcher.deliver({
            text: `Account ${finalized.channelId}:${finalized.accountId} is localOnly but the resolved model "${modelRef}" is not a local provider. Refusing to send data. Check m3.json → channels.<ch>.<acc>.provider.`,
          });
          return;
        }
        contextUsageRatio = estimateContextUsageRatio({
          messages: priorMessages,
          maxContextTokens: resolved.maxContextTokens,
          maxOutputTokens: resolved.maxTokens,
          system: "",
          toolsJsonLength: 4000,
        });
      } catch {
        /* ignore */
      }

      const cmdBridge = new CommandBridge({
        config: this.options.config,
        sessionKey: route.sessionKey,
        channel: finalized.channelId,
        claudeSessionId: mapping?.claudeSessionId,
        messageCount: priorMessages.length,
        contextUsageRatio,
      });

      const cmdResult = cmdBridge.tryHandle(finalized.body);
      if (cmdResult && isClearSessionCommand(cmdResult)) {
        this.options.sessionMapper.remove(route.sessionKey);
        this.goalStore.clear(route.sessionKey);
        if (mapping?.claudeSessionId) {
          if (cmdResult.hard) {
            // Legacy behavior: unlink. The user explicitly opted in
            // with `/clear hard` so we don't second-guess.
            this.transcriptStore.clear(mapping.claudeSessionId);
            await dispatcher.deliver({ text: "Session context cleared (hard delete)." });
          } else {
            // Default: soft-delete to _archive/. Recoverable with
            // `/clear undo`. The archive path is returned so the
            // channel can show the user where to find it (e.g. a
            // /status row, or in TUI mode a "to recover:" line).
            const archivePath = this.transcriptStore.archive(mapping.claudeSessionId);
            const where = archivePath ? ` (archived to ${archivePath})` : "";
            await dispatcher.deliver({
              text: `Session context cleared${where}. Recover with /clear undo.`,
            });
          }
        } else {
          await dispatcher.deliver({ text: "Session context cleared." });
        }
        return;
      }
      if (cmdResult && isClearUndoCommand(cmdResult)) {
        if (mapping?.claudeSessionId) {
          const restored = this.transcriptStore.restoreLatestArchive(mapping.claudeSessionId);
          await dispatcher.deliver({
            text: restored
              ? "Session context restored from archive."
              : "Nothing to restore (no archive for this session).",
          });
        } else {
          await dispatcher.deliver({ text: "No active session to restore." });
        }
        return;
      }
      if (cmdResult && isMemoryCommand(cmdResult)) {
        // C3 part 2 + D3: real /memory handler. Reads, appends, or
        // searches the workspace memory store, keyed by ws-id
        // (not basename — unrelated projects no longer share
        // memory). Imports @m3/agent + @m3/config lazily.
        try {
          const { MemoryStore } = await import("@m3/agent");
          const { resolveWorkspace } = await import("@m3/config");
          const ws = resolveWorkspace(this.options.config.agent.cwd);
          const store = new MemoryStore();
          // Migrate a legacy basename file once per workspace.
          try {
            store.migrateBasenameToWorkspaceId(ws.absPath, ws.id);
          } catch {
            /* best-effort */
          }
          if (cmdResult.subcommand === "append") {
            if (!cmdResult.argument.trim()) {
              await dispatcher.deliver({
                text: "Usage: /memory append <note>",
              });
              return;
            }
            store.append(ws.id, cmdResult.argument);
            await dispatcher.deliver({
              text: `Appended to ~/.m3/memory/${ws.id}.md (workspace: ${ws.label})`,
            });
          } else if (cmdResult.subcommand === "search") {
            if (!cmdResult.argument.trim()) {
              await dispatcher.deliver({
                text: "Usage: /memory search <query>",
              });
              return;
            }
            const hits = store.search(ws.id, cmdResult.argument);
            if (hits.length === 0) {
              await dispatcher.deliver({ text: "no matches" });
            } else {
              await dispatcher.deliver({
                text: `${hits.length} match(es):\n${hits.join("\n---\n")}`,
              });
            }
          } else {
            // read
            const content = store.readAll(ws.id);
            await dispatcher.deliver({
              text: content || `(no memory notes for workspace ${ws.label} / ${ws.id})`,
            });
          }
        } catch (err) {
          await dispatcher.deliver({
            text: `Memory: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        return;
      }
      if (cmdResult && cmdResult.action === "list_mcp_servers") {
        // B8: pull the real listing from the MCP pool and ship it
        // back to the channel. We can't pull this from
        // @m3/commands because commands must stay decoupled from
        // agent — the bridge is the only place that knows about
        // both.
        try {
          const { listServers, listAllMcpTools } = await import("@m3/agent");
          const servers = listServers();
          if (servers.length === 0) {
            await dispatcher.deliver({
              text: `No MCP servers connected.\nConfig: ${this.options.config.agent.mcp?.config ?? "(not set)"}\nPrefix: ${this.options.config.agent.mcp?.toolPrefix ?? "mcp__"}`,
            });
          } else {
            const tools = await listAllMcpTools(servers);
            const byServer = new Map<string, number>();
            for (const t of tools) {
              byServer.set(t.serverId, (byServer.get(t.serverId) ?? 0) + 1);
            }
            const rows = servers.map((s) => {
              const count = byServer.get(s.id) ?? 0;
              return `  ${s.id}\t${count} tool${count === 1 ? "" : "s"}`;
            });
            await dispatcher.deliver({
              text: `MCP servers (${servers.length}):\n${rows.join("\n")}\n\nConfig: ${this.options.config.agent.mcp?.config ?? "(not set)"}\nPrefix: ${this.options.config.agent.mcp?.toolPrefix ?? "mcp__"}`,
            });
          }
        } catch (err) {
          await dispatcher.deliver({
            text: `MCP listing failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        return;
      }
      if (cmdResult && isCompactSessionCommand(cmdResult)) {
        if (!mapping?.claudeSessionId || priorMessages.length === 0) {
          await dispatcher.deliver({ text: "No conversation history to compact yet." });
          return;
        }
        const { messages, summarizedTurns } = compressConversationHistory(priorMessages);
        this.transcriptStore.save(mapping.claudeSessionId, messages);
        const focus = cmdResult.action === "compact_session" ? cmdResult.focus : undefined;
        await dispatcher.deliver({
          text: [
            `Context compacted: ${priorMessages.length} → ${messages.length} message(s).`,
            summarizedTurns > 0 ? `Summarized ${summarizedTurns} earlier turn(s).` : "",
            focus ? `Focus hint: ${focus}` : "",
            "Auto-compress also runs when usage reaches 90% of the context window.",
          ]
            .filter(Boolean)
            .join("\n"),
        });
        return;
      }
      if (cmdResult && cmdResult.action === "set_model") {
        // B6 + D4: persist the user's choice to the
        // per-workspace last-model file. Mid-stream engine
        // change is a refactor away, so the change applies to
        // the next turn / next session.
        try {
          const { saveLastModel, resolveWorkspace } = await import("@m3/config");
          const ws = resolveWorkspace(this.options.config.agent.cwd);
          saveLastModel(cmdResult.model, ws.id);
          await dispatcher.deliver({
            text: `[model] Saved "${cmdResult.model}" to ~/.m3/last-model.${ws.id}.json (workspace: ${ws.label}). The next session will use it; the current in-flight engine is still using its loaded model.`,
          });
        } catch (err) {
          await dispatcher.deliver({
            text: `[model] Failed to persist: ${err instanceof Error ? err.message : err}`,
          });
        }
        return;
      }
      if (cmdResult && isReplyOnlyCommand(cmdResult)) {
        await dispatcher.deliver({ text: cmdResult.action === "reply_only" ? cmdResult.text : "" });
        return;
      }

      let prompt = inboundToPrompt(finalized.body, finalized.media);
      if (cmdResult) {
        prompt = applyCommandResult(cmdResult, prompt);
      }
      // `attachments` only carry image media that the engine should send
      // as vision input. Non-image media already lives in `prompt` (as
      // path strings the LLM can Read), so we filter to image-only here
      // and let `inboundToPrompt` keep its existing behaviour for files.
      const imageAttachments = (finalized.media ?? []).filter((m) => m.type === "image");

      this.options.sessionMapper.upsert({
        sessionKey: route.sessionKey,
        claudeSessionId: mapping?.claudeSessionId,
        workspace: route.workspace ?? mapping?.workspace,
        agentId: route.agentId,
        channel: route.channel,
        accountId: route.accountId,
        peerId: finalized.peerId,
        updatedAt: new Date().toISOString(),
      });

      const stream = new StreamAdapter(dispatcher, {
        verboseTools:
          finalized.channelId === "webchat" && finalized.peerId === "terminal",
        onAssistantDelta:
          finalized.channelId === "webchat"
            ? (delta) => pushWebChatDelta(finalized.peerId, delta)
            : undefined,
        onReasoningDelta:
          finalized.channelId === "webchat"
            ? (delta) => pushWebChatReasoningDelta(finalized.peerId, delta)
            : undefined,
        onTokens:
          finalized.channelId === "webchat"
            ? (usage) => pushWebChatTokens(finalized.peerId, usage)
            : undefined,
        onToolUse:
          finalized.channelId === "webchat"
            ? (info) => pushWebChatToolUse(finalized.peerId, info)
            : undefined,
        onToolResult:
          finalized.channelId === "webchat"
            ? (info) => pushWebChatToolResult(finalized.peerId, info)
            : undefined,
        onSystemNotice:
          finalized.channelId === "webchat"
            ? (text) => pushWebChatSystem(finalized.peerId, text)
            : undefined,
      });
      let sessionId = mapping?.claudeSessionId;

      const channelAgent = agentConfigForChannel(this.options.config.agent, {
        channelId: finalized.channelId,
        peerId: finalized.peerId,
      });
      const cwd = route.workspace ?? resolveAgentWorkspace(this.options.config.agent);
      const permissionHandler = createPermissionHandler(
        this.options.permissionBridge,
        () => channelAgent.permissionMode,
        cwd,
      );

      for await (const evt of this.options.engine.run({
        prompt,
        sessionId,
        cwd,
        resume: Boolean(sessionId),
        permissionMode: channelAgent.permissionMode,
        ...(imageAttachments.length > 0 ? { attachments: imageAttachments } : {}),
        permissionHandler,
      })) {
        await stream.handleEvent(evt);
        if (evt.type === "session_id") {
          sessionId = evt.sessionId;
          this.options.sessionMapper.setClaudeSessionId(route.sessionKey, evt.sessionId);
        }
      }

      await stream.flushFinal();

      const activeGoal = this.goalStore.get(route.sessionKey);
      if (activeGoal && sessionId) {
        const transcript = this.transcriptStore.load(sessionId);
        const lastAssistant = [...transcript]
          .reverse()
          .find((m) => m.role === "assistant");
        const lastText =
          typeof lastAssistant?.content === "string"
            ? lastAssistant.content
            : JSON.stringify(lastAssistant?.content ?? "");
        if (/goal_met/i.test(lastText)) {
          this.goalStore.clear(route.sessionKey);
          await dispatcher.deliver({ text: "◎ Goal met — goal cleared." });
        } else if (activeGoal.turns < 8) {
          this.goalStore.incrementTurn(route.sessionKey);
          await dispatcher.deliver({
            text: `◎ Goal active (${activeGoal.turns + 1} turns): ${activeGoal.condition}\nSend another message or /goal clear to stop.`,
          });
        }
      }

      await this.markFeishuDone(finalized);
      this.log("info", `handled ${finalized.channelId} peer=${finalized.peerId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log("error", `inbound failed: ${msg}`);
      const userMsg = formatInboundError(msg);
      try {
        await dispatcher.deliver({
          text: userMsg,
        });
      } catch {
        // ignore double failure
      }
    }
  }

  private async markFeishuDone(message: InboundMessage): Promise<void> {
    if (message.channelId !== "feishu" || !message.sourceMessageId) return;
    try {
      await feishuReactToMessage(
        this.options.config,
        message.accountId,
        message.sourceMessageId,
        "THUMBSUP",
      );
    } catch {
      // best-effort completion reaction
    }
  }

  getPairingStore(): PairingStore {
    return this.pairingStore;
  }
}

function formatInboundError(msg: string): string {
  const lower = msg.toLowerCase();
  if (lower.includes("context size") || lower.includes("context window") || lower.includes("exceeds the available context")) {
    return [
      "Error: prompt is too long for the current model context.",
      "Try: /clear — then send a shorter message.",
      "Local model: m3 local stop && m3 local --ctx-size 32768",
    ].join("\n");
  }
  if (lower.includes("socket timeout") || lower.includes("err_socket_timeout")) {
    return [
      "Error: API connection timed out (Socket timeout).",
      "Check: network, API key in ~/.m3/secrets.json, m3 doctor",
      "Try: m3 model deepseek-chat (or another provider), /clear, then retry",
      "If using MiniMax: confirm baseUrl (CN: https://api.minimaxi.com/v1)",
    ].join("\n");
  }
  return `Error: ${msg.slice(0, 500)}`;
}

export function createMessagePipeline(options: MessagePipelineOptions): MessagePipeline {
  return new MessagePipeline(options);
}

export type { PairingRecord } from "./pairing-store.js";
export { PairingStore } from "./pairing-store.js";
export { SessionLock } from "./session-lock.js";

/** @deprecated use PairingStore from pairing-store.js */
export type ThreadBinding = {
  sessionKey: string;
  threadId: string;
  channel: string;
  peerId: string;
};

export class ThreadBindingStore {
  private bindings = new Map<string, ThreadBinding>();

  bind(binding: ThreadBinding): void {
    this.bindings.set(binding.threadId, binding);
  }

  get(threadId: string): ThreadBinding | undefined {
    return this.bindings.get(threadId);
  }
}
