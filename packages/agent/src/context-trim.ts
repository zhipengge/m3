import type { ContentBlock, HarnessMessage } from "./harness/types.js";

/** Fraction of maxContextTokens at which we compress history (default 90%). */
export const DEFAULT_CONTEXT_COMPRESS_RATIO = 0.9;

/** Rough token estimate (chars / 3) — good enough for budget trimming. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3);
}

export function messageToText(message: HarnessMessage): string {
  if (typeof message.content === "string") return message.content;
  return JSON.stringify(message.content);
}

export type ContextBudgetParams = {
  messages: HarnessMessage[];
  maxContextTokens: number;
  maxOutputTokens: number;
  system?: string;
  toolsJsonLength?: number;
  /** Compress when estimated usage ≥ ratio × maxContextTokens (default 0.9). */
  compressRatio?: number;
};

export function estimateContextOverhead(params: {
  system?: string;
  toolsJsonLength?: number;
  maxOutputTokens: number;
}): number {
  return (
    estimateTokens(params.system ?? "") +
    Math.ceil((params.toolsJsonLength ?? 0) / 3) +
    params.maxOutputTokens +
    256
  );
}

export function estimateMessagesTokens(messages: HarnessMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(messageToText(m)), 0);
}

/** Estimated tokens used vs context window (0–1+). */
export function estimateContextUsageRatio(params: ContextBudgetParams): number {
  const overhead = estimateContextOverhead({
    system: params.system,
    toolsJsonLength: params.toolsJsonLength,
    maxOutputTokens: params.maxOutputTokens,
  });
  const used = overhead + estimateMessagesTokens(params.messages);
  return used / params.maxContextTokens;
}

export function shouldCompressContext(
  params: ContextBudgetParams,
  ratio: number = params.compressRatio ?? DEFAULT_CONTEXT_COMPRESS_RATIO,
): boolean {
  return estimateContextUsageRatio(params) >= ratio;
}

const COMPRESSED_HEADER =
  "[Earlier conversation compressed to stay within context limits]\n\n";

const RECENT_MESSAGES_KEEP = 6;
const SUMMARY_LINE_MAX = 480;
const SUMMARY_TOTAL_MAX = 14_000;
const TOOL_RESULT_CAP = 1_500;

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… [truncated ${text.length - max} chars]`;
}

function truncateContentBlocks(blocks: ContentBlock[], toolCap: number): ContentBlock[] {
  return blocks.map((block) => {
    if (block.type === "tool_result") {
      return {
        ...block,
        content: truncateText(block.content, toolCap),
      };
    }
    if (block.type === "text") {
      return { ...block, text: truncateText(block.text, toolCap) };
    }
    return block;
  });
}

function truncateMessageContent(
  content: string | ContentBlock[],
  toolCap: number,
): string | ContentBlock[] {
  if (typeof content === "string") {
    return truncateText(content, toolCap * 2);
  }
  return truncateContentBlocks(content, toolCap);
}

/** Shrink oversized tool outputs in place (all messages). */
export function truncateOversizedToolResults(
  messages: HarnessMessage[],
  maxChars: number = TOOL_RESULT_CAP,
): HarnessMessage[] {
  return messages.map((msg) => ({
    ...msg,
    content: truncateMessageContent(msg.content, maxChars),
  }));
}

function summarizeContentBlocks(blocks: ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text" && block.text.trim()) {
      parts.push(block.text.trim());
    } else if (block.type === "tool_use") {
      parts.push(`[tool ${block.name}]`);
    } else if (block.type === "tool_result") {
      const preview = truncateText(block.content.replace(/\s+/g, " ").trim(), 200);
      parts.push(`[tool result${block.is_error ? " error" : ""}] ${preview}`);
    }
  }
  return parts.join(" ");
}

function formatMessageLine(message: HarnessMessage): string {
  const role = message.role === "user" ? "User" : "Assistant";
  const body =
    typeof message.content === "string"
      ? message.content
      : summarizeContentBlocks(message.content);
  const oneLine = body.replace(/\s+/g, " ").trim();
  return `- ${role}: ${truncateText(oneLine, SUMMARY_LINE_MAX)}`;
}

function buildHistorySummary(messages: HarnessMessage[]): string {
  const lines = messages.map(formatMessageLine);
  let text = lines.join("\n");
  if (text.length > SUMMARY_TOTAL_MAX) {
    const kept = lines.slice(-Math.max(4, Math.floor(lines.length / 3)));
    text = [
      `… ${lines.length - kept.length} earlier turn(s) omitted …`,
      ...kept,
    ].join("\n");
    text = truncateText(text, SUMMARY_TOTAL_MAX);
  }
  return COMPRESSED_HEADER + text;
}

/**
 * Replace older turns with a single summary user message; keep recent tail intact.
 */
export type CompressHistoryResult = {
  messages: HarnessMessage[];
  summarizedTurns: number;
};

export function compressConversationHistory(
  messages: HarnessMessage[],
  recentKeep: number = RECENT_MESSAGES_KEEP,
): CompressHistoryResult {
  if (messages.length <= recentKeep + 1) {
    return { messages: truncateOversizedToolResults(messages), summarizedTurns: 0 };
  }

  const head = messages.slice(0, -recentKeep);
  const tail = truncateOversizedToolResults(messages.slice(-recentKeep));
  const summary: HarnessMessage = {
    role: "user",
    content: buildHistorySummary(head),
  };
  return {
    messages: [summary, ...tail],
    summarizedTurns: head.length,
  };
}

export type ContextPrepareResult = {
  /** Full history after compression (for session persistence). */
  sessionMessages: HarnessMessage[];
  /** Messages sent to the model this turn (may trim further). */
  apiMessages: HarnessMessage[];
  compressed: boolean;
  summarizedTurns: number;
  trimmed: boolean;
};

/** Compress at 90%+ usage, then trim to hard budget for the API call. */
export function prepareMessagesForContext(params: ContextBudgetParams): ContextPrepareResult {
  let working = params.messages;
  let compressed = false;
  let summarizedTurns = 0;

  if (shouldCompressContext(params)) {
    const result = compressConversationHistory(working);
    working = result.messages;
    summarizedTurns = result.summarizedTurns;
    compressed = true;
  }

  const apiMessages = applyContextBudget({ ...params, messages: working });
  return {
    sessionMessages: working,
    apiMessages,
    compressed,
    summarizedTurns,
    trimmed: apiMessages.length < working.length,
  };
}

/** Keep the latest messages that fit within tokenBudget (always keeps at least the last pair). */
export function trimMessagesToBudget(
  messages: HarnessMessage[],
  tokenBudget: number,
): HarnessMessage[] {
  if (messages.length <= 2 || tokenBudget <= 0) return messages;

  const kept: HarnessMessage[] = [];
  let used = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!;
    const cost = estimateTokens(messageToText(msg));
    if (used + cost > tokenBudget && kept.length >= 2) break;
    used += cost;
    kept.unshift(msg);
  }

  return kept.length > 0 ? kept : messages.slice(-2);
}

export function applyContextBudget(params: ContextBudgetParams): HarnessMessage[] {
  const overhead =
    estimateTokens(params.system ?? "") +
    Math.ceil((params.toolsJsonLength ?? 0) / 3) +
    256;
  const budget = params.maxContextTokens - params.maxOutputTokens - overhead;
  if (budget <= 0) return params.messages.slice(-2);
  return trimMessagesToBudget(params.messages, budget);
}
