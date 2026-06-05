import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createIdleWatchdog, readIdleTimeoutMs } from "./idle-watchdog.js";

describe("readIdleTimeoutMs", () => {
  const originalEnv = process.env.M3_LLM_IDLE_TIMEOUT_MS;
  beforeEach(() => {
    delete process.env.M3_LLM_IDLE_TIMEOUT_MS;
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.M3_LLM_IDLE_TIMEOUT_MS;
    else process.env.M3_LLM_IDLE_TIMEOUT_MS = originalEnv;
  });

  it("defaults to 10 minutes", () => {
    expect(readIdleTimeoutMs()).toBe(10 * 60 * 1000);
  });

  it("honours M3_LLM_IDLE_TIMEOUT_MS", () => {
    process.env.M3_LLM_IDLE_TIMEOUT_MS = "30000";
    expect(readIdleTimeoutMs()).toBe(30_000);
  });

  it("ignores non-numeric values", () => {
    process.env.M3_LLM_IDLE_TIMEOUT_MS = "abc";
    expect(readIdleTimeoutMs()).toBe(10 * 60 * 1000);
  });
});

describe("createIdleWatchdog", () => {
  it("fires the callback when no bump arrives within idleMs", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    // The watchdog checks idle/10 interval, so use idleMs that's at
    // least 10x the tick boundary. The check is `> idleMs` (strict
    // greater-than) so we need to advance past one full tick boundary
    // AND past idleMs.
    const wd = createIdleWatchdog(10_000, onIdle);
    vi.advanceTimersByTime(11_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
    wd.stop();
    vi.useRealTimers();
  });

  it("resets the timer on bump", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const wd = createIdleWatchdog(10_000, onIdle);
    vi.advanceTimersByTime(9_000);
    wd.bump();
    vi.advanceTimersByTime(9_000);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_100);
    // First tick at 10s after the bump: fires once.
    expect(onIdle).toHaveBeenCalledTimes(1);
    wd.stop();
    vi.useRealTimers();
  });

  it("does not fire when idleMs is 0", () => {
    const onIdle = vi.fn();
    const wd = createIdleWatchdog(0, onIdle);
    wd.bump();
    wd.stop();
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("stop() clears the interval (no late fire)", () => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const wd = createIdleWatchdog(500, onIdle);
    vi.advanceTimersByTime(200);
    wd.stop();
    vi.advanceTimersByTime(2000);
    expect(onIdle).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
