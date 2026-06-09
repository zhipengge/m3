import type { LlmProvider, LlmStreamCallbacks, LlmTurnParams, LlmTurnResult } from "./types.js";

/**
 * CascadeLlmProvider — try a cheap local model first, escalate to a
 * stronger cloud model on demand. The escalation rule is:
 *
 *   - Local returned a tool_use block → escalate (the local model
 *     reached for a tool, so it needs the full tool grammar; cloud
 *     models handle the tool round-trip more reliably).
 *   - Local returned < `escalateBelow` characters of plain text and
 *     no tool_use → escalate (a 5-word "I'm not sure" is the
 *     signature of a small model failing on the prompt).
 *   - Otherwise → return the local result (it was good enough; the
 *     user got their answer for free).
 *
 * Configured via m3.json as:
 *
 *   "models": {
 *     "providers": {
 *       "cascade": {
 *         "api": "cascade",
 *         "baseUrl": "local:anthropic",   // "local:<ref>" then "cloud:<ref>"
 *         "model": "cascade:default"
 *       }
 *     }
 *   }
 *
 * The router sees `api: "cascade"` and looks up this provider via
 * `registerLlmProvider("cascade", new CascadeLlmProvider(local, cloud, opts))`.
 *
 * The escalation is observable to the harness via the
 * `escalated` flag on the result (added below), so the StatusBar
 * can render "cascade: local ✓" or "cascade: local→cloud".
 */
export type CascadeOpts = {
  /** Character count below which a text-only local response escalates. */
  escalateBelow?: number;
};

export type CascadeLlmResult = LlmTurnResult & {
  /** Which provider actually answered. */
  escalated: boolean;
  /** Which provider was selected initially (always "local" for now). */
  attempted: "local" | "cloud";
};

export class CascadeLlmProvider implements LlmProvider {
  readonly id = "cascade";

  constructor(
    private readonly local: LlmProvider,
    private readonly cloud: LlmProvider,
    private readonly opts: CascadeOpts = {},
  ) {}

  async completeTurn(
    params: LlmTurnParams,
    callbacks?: LlmStreamCallbacks,
  ): Promise<CascadeLlmResult> {
    const escalateBelow = this.opts.escalateBelow ?? 30;
    const localResult = await this.local.completeTurn(params, callbacks);
    if (this.shouldEscalate(localResult, escalateBelow)) {
      // Re-issue the call to cloud. The local tokens still count
      // toward cumulative session cost (the user did pay for them)
      // but the cloud response is what the user sees.
      const cloudResult = await this.cloud.completeTurn(params, callbacks);
      return { ...cloudResult, escalated: true, attempted: "local" };
    }
    return { ...localResult, escalated: false, attempted: "local" };
  }

  private shouldEscalate(result: LlmTurnResult, escalateBelow: number): boolean {
    // Any tool_use → escalate (local lacks the tool round-trip
    // reliability for our purposes).
    if (result.assistantContent.some((b) => b.type === "tool_use")) return true;
    // Short text with no tool → escalate.
    if (result.text.length < escalateBelow) return true;
    return false;
  }
}
