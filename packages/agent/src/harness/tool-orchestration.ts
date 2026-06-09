import type { ToolUseBlock } from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import type { ToolContext, ToolDefinition, HarnessEvent } from "../harness/types.js";
import { findToolByName } from "../tools/registry.js";
import { PermissionManager } from "../permissions/manager.js";
import { AuditLog, fileAuditSink, summarizeInput } from "../security/audit.js";
import { describeToolCall } from "./tool-description.js";

const auditLog = new AuditLog(fileAuditSink);

type ToolBatch = { concurrent: boolean; blocks: ToolUseBlock[] };

/** Partition tool calls — migrated from CC toolOrchestration.partitionToolCalls */
export function partitionToolCalls(
  blocks: ToolUseBlock[],
  tools: ToolDefinition[],
): ToolBatch[] {
  const batches: ToolBatch[] = [];
  for (const block of blocks) {
    const tool = findToolByName(tools, block.name);
    const safe = Boolean(tool?.isReadOnly && tool?.isConcurrencySafe);
    const last = batches[batches.length - 1];
    if (safe && last?.concurrent) {
      last.blocks.push(block);
    } else if (safe) {
      batches.push({ concurrent: true, blocks: [block] });
    } else {
      batches.push({ concurrent: false, blocks: [block] });
    }
  }
  return batches;
}

export async function* executeTools(
  blocks: ToolUseBlock[],
  tools: ToolDefinition[],
  ctx: ToolContext,
  permissions: PermissionManager,
): AsyncGenerator<HarnessEvent, void> {
  for (const batch of partitionToolCalls(blocks, tools)) {
    if (batch.concurrent) {
      const results = await Promise.all(
        batch.blocks.map((block) => runSingleTool(block, tools, ctx, permissions)),
      );
      for (const result of results) {
        yield* result.events;
      }
    } else {
      for (const block of batch.blocks) {
        const result = await runSingleTool(block, tools, ctx, permissions);
        yield* result.events;
      }
    }
  }
}

async function runSingleTool(
  block: ToolUseBlock,
  tools: ToolDefinition[],
  ctx: ToolContext,
  permissions: PermissionManager,
): Promise<{ events: HarnessEvent[] }> {
  const events: HarnessEvent[] = [];
  const tool = findToolByName(tools, block.name);

  events.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });

  if (!tool) {
    events.push({
      type: "tool_result",
      id: block.id,
      name: block.name,
      output: `Unknown tool: ${block.name}`,
      isError: true,
    });
    return { events };
  }

  const input = block.input as Record<string, unknown> | undefined;
  // Concrete one-line description used by the TUI permission prompt and
  // by the Slack/Feishu fallback formatter — see describeToolCall for
  // the rules (Bash: <command>, Read: <path>, etc.).
  const description = describeToolCall(tool.name, input);
  const decision = await permissions.canUseTool({
    toolName: tool.name,
    toolInput: block.input,
    isReadOnly: Boolean(tool.isReadOnly),
    needsPermission: Boolean(tool.needsPermission),
    description,
    sessionKey: ctx.sessionId,
  });

  auditLog.record({
    sessionId: ctx.sessionId,
    toolName: tool.name,
    decision,
    summary: summarizeInput(block.input),
  });

  if (decision === "deny") {
    process.stderr.write(
      `[m3:audit] permission denied tool=${tool.name} mode=${ctx.permissionMode}\n`,
    );
    events.push({
      type: "tool_result",
      id: block.id,
      name: block.name,
      output: `Permission denied (${tool.name}). Approve when prompted, or set agent.permissionMode to acceptEdits in ~/.m3/m3.json.`,
      isError: true,
    });
    return { events };
  }

  try {
    const result = await tool.execute(block.input, ctx);
    events.push({
      type: "tool_result",
      id: block.id,
      name: block.name,
      output: result.content,
      isError: result.isError,
    });
  } catch (err) {
    events.push({
      type: "tool_result",
      id: block.id,
      name: block.name,
      output: err instanceof Error ? err.message : String(err),
      isError: true,
    });
  }

  return { events };
}
