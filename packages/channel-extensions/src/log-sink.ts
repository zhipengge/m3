/**
 * Per-channel log file sink.
 *
 * Channel managers and the Feishu long-connection use `runtime.log`
 * to surface connection lifecycle / event errors. By default those
 * messages land on the gateway's stdout only — easy to lose when
 * the gateway is running in the background. This helper wraps the
 * runtime so every log line is also appended to
 * `~/.m3/logs/<channel>/<account>/<YYYY-MM-DD>.log` (one file per
 * day, 0o600), so a user can `tail -f` the day's file or grep a
 * dropped connection post-mortem.
 *
 * The wrapping is additive — the original `runtime.log` is still
 * called first, so the terminal output is unchanged. The file
 * append is best-effort: a write failure is silently swallowed
 * (we don't want a logging layer to crash the gateway).
 */
import fs from "node:fs";
import path from "node:path";
import { expandHome } from "@m3/config";
import type { ChannelRuntimeContext } from "@m3/channels";

const LOG_ROOT = "~/.m3/logs";

function logDir(channelId: string, accountId: string): string {
  return path.join(expandHome(LOG_ROOT), channelId, accountId);
}

function todayFile(channelId: string, accountId: string): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return path.join(logDir(channelId, accountId), `${y}-${m}-${day}.log`);
}

/**
 * Return a new runtime whose `log` callback mirrors the original
 * to a per-channel daily log file. Cheap — the wrap is a single
 * closure and the append is O(1) per line.
 */
export function withChannelLogFile(
  channelId: string,
  accountId: string,
  runtime: ChannelRuntimeContext,
): ChannelRuntimeContext {
  return {
    ...runtime,
    log: (msg: string) => {
      runtime.log(msg);
      try {
        const dir = logDir(channelId, accountId);
        fs.mkdirSync(dir, { recursive: true });
        const fp = todayFile(channelId, accountId);
        const ts = new Date().toISOString();
        // mode 0o600 — transcripts and audit logs follow the same
        // convention. appendFileSync with O_APPEND serialises
        // concurrent writers at the filesystem level.
        fs.appendFileSync(fp, `[${ts}] ${msg}\n`, { mode: 0o600 });
      } catch {
        // best-effort; never crash the gateway on a logging failure
      }
    },
  };
}
