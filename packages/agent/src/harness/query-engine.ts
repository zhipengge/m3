import { randomUUID } from "node:crypto";
import type { AgentConfig, ResolvedModel } from "@m3/config";
import { resolveAgentWorkspace } from "@m3/config";
import type { PermissionHandler } from "../permissions/manager.js";
import { runQueryLoopSafe } from "./query-loop.js";
import type { HarnessEvent } from "./types.js";
import { SessionMessageStore } from "../session/message-store.js";
import { collectTools } from "../tools/tool-source.js";
import { DEFAULT_SANDBOX, type SandboxPolicy } from "../security/workspace.js";

export type QueryEngineOptions = {
  agent: AgentConfig;
  model: ResolvedModel;
};

/** Session-level wrapper — migrated from CC QueryEngine.ts (minimal). */
export class QueryEngine {
  private readonly store = new SessionMessageStore();

  constructor(private readonly options: QueryEngineOptions) {}

  async *submit(params: {
    prompt: string;
    sessionId?: string;
    cwd?: string;
    planMode?: boolean;
    abortSignal?: AbortSignal;
    resume?: boolean;
    permissionMode?: AgentConfig["permissionMode"];
    permissionHandler?: PermissionHandler;
    attachments?: Array<{ type: "image" | "file"; path: string; mimeType?: string }>;
  }): AsyncGenerator<HarnessEvent, { text: string; sessionId: string }> {
    const sessionId = params.sessionId ?? randomUUID();
    const cwd = params.cwd ?? resolveAgentWorkspace(this.options.agent);
    const resumeMessages =
      params.resume && params.sessionId ? this.store.load(params.sessionId) : undefined;

    const sandbox: SandboxPolicy = {
      enabled: this.options.agent.sandbox?.enabled ?? DEFAULT_SANDBOX.enabled,
      allowReadOutside:
        this.options.agent.sandbox?.allowReadOutside ?? DEFAULT_SANDBOX.allowReadOutside,
    };
    const { tools, systemPrompt } = await collectTools(this.options.agent);
    // C7: layer in project-memory (CLAUDE.md / AGENTS.md) on top
    // of the tool-derived system prompt. The two are independent
    // concerns — skills / MCP / memory each contribute their own
    // fragment; project memory is filesystem-based and a
    // user-controlled override surface.
    const { loadProjectMemory } = await import("../project-memory.js");
    const projectMem = loadProjectMemory({ cwd: this.options.agent.cwd });

    const loop = runQueryLoopSafe({
      prompt: params.prompt,
      sessionId,
      cwd,
      model: this.options.model,
      tools,
      permissionMode: params.permissionMode ?? this.options.agent.permissionMode,
      planMode: params.planMode ?? this.options.agent.planMode,
      maxTurns: this.options.agent.maxTurns,
      abortSignal: params.abortSignal,
      resumeMessages,
      sandbox,
      bashEnvAllow: this.options.agent.sandbox?.bashEnvAllow,
      extraSystem: [systemPrompt, projectMem.block].filter(Boolean).join("\n\n") || undefined,
      permissionHandler: params.permissionHandler,
      attachments: params.attachments,
      allowPatterns: this.options.agent.permissions?.allow ?? [],
      denyPatterns: this.options.agent.permissions?.deny ?? [],
    });

    let result = await loop.next();
    while (!result.done) {
      yield result.value;
      result = await loop.next();
    }

    // `result.value` is QueryLoopResult | undefined: runQueryLoopSafe
    // yields a final tick carrying the underlying result and returns
    // it; if the loop exited with an exception, the for-await above
    // re-throws and we never reach this point. Still — narrow for TS.
    const finalResult = result.value;
    if (!finalResult) {
      throw new Error("agent run exited without producing a result");
    }
    this.store.save(sessionId, finalResult.messages);
    return { text: finalResult.text, sessionId };
  }
}
