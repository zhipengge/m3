import type { ToolUseBlock } from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import type { ToolContext, ToolDefinition, HarnessEvent } from "../harness/types.js";
import { findToolByName } from "../tools/registry.js";
import { PermissionManager } from "../permissions/manager.js";
import { AuditLog, summarizeInput } from "../security/audit.js";

const auditLog = new AuditLog();

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

  const decision = await permissions.canUseTool({
    toolName: tool.name,
    isReadOnly: Boolean(tool.isReadOnly),
    needsPermission: Boolean(tool.needsPermission),
    description: `Execute ${tool.name}`,
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
      output: `Permission denied (${tool.name}). Set agent.channelPermissionMode to bypassPermissions in ~/.m3/m3.json and restart gateway.`,
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
