/**
 * Shared idle-watchdog for the LLM stream consumers (OpenAI + Anthropic
 * providers). Replaces the two near-identical setInterval blocks that
 * used to live in each provider. The watchdog runs alongside the
 * stream, periodically checking `lastEventAt`; if no event fires
 * within the configured timeout, the `onIdle` callback fires.
 *
 * Why this exists: slow reasoning models (DeepSeek Reasoner, MiniMax
 * reasoning_split, Anthropic extended thinking) can legitimately pause
 * for several minutes between chunks. We need a *real* timer-based
 * check, not a post-hoc one inside the for-await — a silent socket
 * death would otherwise hang forever. The user can dial the timeout
 * with M3_LLM_IDLE_TIMEOUT_MS (set to 0 to disable).
 *
 * Returns a `stop()` that clears the interval. Callers MUST stop the
 * watchdog in a `finally` block to avoid leaking timers.
 */
/** Returns the idle timeout in ms, honoring M3_LLM_IDLE_TIMEOUT_MS. */
export function readIdleTimeoutMs(): number {
  const raw = process.env.M3_LLM_IDLE_TIMEOUT_MS;
  if (raw && /^\d+$/.test(raw)) {
    const n = Number(raw);
    if (n >= 0) return n;
  }
  return 10 * 60 * 1000; // 10 minutes default
}

export type IdleWatchdog = {
  /** Mark "something just happened" — call after every chunk / event. */
  bump: () => void;
  /** Stop the interval. Safe to call multiple times. */
  stop: () => void;
};

export function createIdleWatchdog(
  idleMs: number,
  onIdle: () => void,
): IdleWatchdog {
  if (idleMs <= 0) {
    return { bump: () => {}, stop: () => {} };
  }
  let lastEventAt = Date.now();
  const interval = Math.max(1000, Math.floor(idleMs / 10));
  // Use the global setInterval so vitest's fake-timer can mock it in
  // tests. (Importing from `node:timers` is the same impl, but the
  // named-import form bypasses vi's auto-mock.)
  const timer = globalThis.setInterval(() => {
    if (Date.now() - lastEventAt > idleMs) onIdle();
  }, interval);
  return {
    bump: () => {
      lastEventAt = Date.now();
    },
    stop: () => globalThis.clearInterval(timer),
  };
}
