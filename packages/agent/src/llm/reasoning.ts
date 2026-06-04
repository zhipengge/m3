/** Models that support separated reasoning via OpenAI-compatible extra_body. */
export function modelUsesReasoningSplit(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (id.startsWith("minimax-")) return true;
  if (id.includes("deepseek-reasoner")) return true;
  return false;
}

export type ReasoningExtract = {
  /** Incremental text to append for this chunk. */
  delta: string;
  /** Full cumulative reasoning text after this chunk. */
  cumulative: string;
};

/** Parse reasoning from an OpenAI-style stream delta (MiniMax, DeepSeek reasoner, etc.). */
export function extractOpenAiReasoningDelta(
  delta: Record<string, unknown>,
  prevCumulative: string,
): ReasoningExtract | null {
  const rc = delta.reasoning_content;
  if (typeof rc === "string" && rc.length > 0) {
    if (rc.length > prevCumulative.length && rc.startsWith(prevCumulative)) {
      return { delta: rc.slice(prevCumulative.length), cumulative: rc };
    }
    if (rc.length > prevCumulative.length) {
      const cumulative = prevCumulative + rc;
      return { delta: rc, cumulative };
    }
  }

  const details = delta.reasoning_details;
  if (Array.isArray(details)) {
    let full = "";
    for (const item of details) {
      if (item && typeof item === "object" && "text" in item) {
        const t = (item as { text: unknown }).text;
        if (typeof t === "string") full += t;
      }
    }
    if (full.length > prevCumulative.length) {
      return { delta: full.slice(prevCumulative.length), cumulative: full };
    }
  }

  const reasoning = delta.reasoning;
  if (typeof reasoning === "string" && reasoning.length > prevCumulative.length) {
    return { delta: reasoning.slice(prevCumulative.length), cumulative: reasoning };
  }

  return null;
}
