import { spawn } from "node:child_process";
import { z } from "zod";
import type { ToolDefinition } from "../harness/types.js";
import { buildSandboxedEnv } from "../security/workspace.js";

const BashInput = z.object({
  command: z.string(),
  description: z.string().optional(),
  timeout: z.number().int().min(1000).max(600_000).optional(),
});

const DEFAULT_TIMEOUT = 120_000;

export const bashTool: ToolDefinition = {
  name: "Bash",
  description: "Run a shell command in the project workspace.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string" },
      description: { type: "string" },
      timeout: { type: "number", description: "Timeout in ms (default 120000)" },
    },
    required: ["command"],
  },
  needsPermission: true,
  execute: async (raw, ctx) => {
    const input = BashInput.parse(raw);
    const timeout = input.timeout ?? DEFAULT_TIMEOUT;

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

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve({ content: `Timeout after ${timeout}ms\n${stdout}\n${stderr}`, isError: true });
      }, timeout);

      if (ctx.abortSignal) {
        ctx.abortSignal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
      }

      child.on("close", (code) => {
        clearTimeout(timer);
        const output = [stdout, stderr].filter(Boolean).join("\n") || "(no output)";
        resolve({
          content: `exit code: ${code ?? 1}\n${output}`,
          isError: code !== 0,
        });
      });
    });
  },
};
