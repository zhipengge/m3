import { spawn } from "node:child_process";
import { z } from "zod";
import type { ToolDefinition } from "../harness/types.js";
import { buildSandboxedEnv } from "../security/workspace.js";
import { checkBashSafety } from "./bash-safety.js";

const BashInput = z.object({
  command: z.string(),
  description: z.string().optional(),
  timeout: z.number().int().min(1000).max(3_600_000).optional(),
});

/**
 * Default timeout per Bash invocation. Previously 120s, which routinely
 * killed `pnpm install` / `pnpm build` / `cargo build` / `go test` on
 * large projects and made the agent think the command had failed. 10
 * minutes matches the upstream LLM socket timeout and the typical
 * "I should let a long build finish" expectation. Override with
 * `M3_BASH_TIMEOUT_MS=<ms>`.
 */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
/** After SIGTERM, give the child this long to exit before SIGKILL. */
const SIGKILL_GRACE_MS = 5_000;

function resolveDefaultTimeout(): number {
  const override = process.env.M3_BASH_TIMEOUT_MS;
  if (override && /^\d+$/.test(override)) {
    const n = Number(override);
    if (n >= 1000 && n <= 3_600_000) return n;
  }
  return DEFAULT_TIMEOUT_MS;
}

/**
 * When true (default), the Bash tool refuses to execute commands that match
 * the dangerous-pattern list in `bash-safety.ts`. Disable in config to opt
 * out (e.g. for trusted developer workflows).
 */
function bashSafetyEnabled(): boolean {
  return process.env.M3_BASH_SAFETY !== "0";
}

export const bashTool: ToolDefinition = {
  name: "Bash",
  description: "Run a shell command in the project workspace.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string" },
      description: { type: "string" },
      timeout: {
        type: "number",
        description: "Timeout in ms (default 600000, env M3_BASH_TIMEOUT_MS, max 3600000)",
      },
    },
    required: ["command"],
  },
  needsPermission: true,
  execute: async (raw, ctx) => {
    const input = BashInput.parse(raw);
    const timeout = input.timeout ?? resolveDefaultTimeout();

    if (bashSafetyEnabled()) {
      const verdict = checkBashSafety(input.command);
      if (!verdict.safe) {
        return {
          content: `Refused: ${verdict.reason} (pattern: ${verdict.pattern}). ` +
            `If this is intentional, set M3_BASH_SAFETY=0 for this run.`,
          isError: true,
        };
      }
    }

    const env = ctx.sandbox.enabled
      ? buildSandboxedEnv(process.env, ctx.bashEnvAllow)
      : { ...process.env };

    return new Promise((resolve) => {
      const child = spawn(input.command, {
        shell: true,
        cwd: ctx.cwd,
        env,
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => {
        stdout += d.toString();
      });
      child.stderr.on("data", (d: Buffer) => {
        stderr += d.toString();
      });

      let resolved = false;
      let sigkillTimer: ReturnType<typeof setTimeout> | null = null;
      const settle = (result: { content: string; isError?: boolean }) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        if (sigkillTimer) clearTimeout(sigkillTimer);
        resolve(result);
      };

      const escalateKill = () => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* already gone */
        }
        sigkillTimer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* already gone */
          }
        }, SIGKILL_GRACE_MS);
      };

      const timer = setTimeout(() => {
        // Try graceful exit first. Some shells / shellscripts trap SIGTERM
        // and do cleanup; a forced SIGKILL a few seconds later catches the
        // truly stuck ones (e.g. infinite loops that ignore signals).
        escalateKill();
        settle({
          content: `Timeout after ${timeout}ms (SIGTERM sent; SIGKILL in ${SIGKILL_GRACE_MS}ms if still running)\n${stdout}\n${stderr}`,
          isError: true,
        });
      }, timeout);

      if (ctx.abortSignal) {
        ctx.abortSignal.addEventListener("abort", () => escalateKill(), { once: true });
      }

      child.on("close", (code) => {
        // The on-close path is the "happy" case (process exited under its
        // own steam, or got SIGKILLed). Only use the real exit code if we
        // haven't already settled on a timeout.
        if (!resolved) {
          const output = [stdout, stderr].filter(Boolean).join("\n") || "(no output)";
          settle({
            content: `exit code: ${code ?? 1}\n${output}`,
            isError: code !== 0,
          });
        }
      });

      child.on("error", (err) => {
        settle({
          content: `spawn error: ${err.message}\n${stdout}\n${stderr}`,
          isError: true,
        });
      });
    });
  },
};
