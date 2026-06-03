import readline from "node:readline";
import type { PermissionBridge, PermissionRequest } from "@m3/bridge";
import { getReplUiSink } from "./tui/repl-bridge.js";

function parseDecision(line: string): "approve" | "deny" | null {
  const t = line.trim().toLowerCase();
  if (t === "y" || t === "yes" || t === "approve" || t === "a") return "approve";
  if (t === "n" || t === "no" || t === "deny" || t === "d") return "deny";
  return null;
}

function promptReadline(request: PermissionRequest): Promise<"approve" | "deny"> {
  process.stderr.write(
    `\n\x1b[33m[m3 permission]\x1b[0m ${request.toolName}\n  ${request.description}\n  Allow? [y/N] `,
  );
  return new Promise<"approve" | "deny">((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: true,
    });
    rl.question("", (answer) => {
      rl.close();
      const decision = parseDecision(answer) ?? "deny";
      process.stderr.write(decision === "approve" ? "approved\n" : "denied\n");
      resolve(decision);
    });
  });
}

/** Interactive y/n for terminal REPL — Ink UI when active, else readline on stderr. */
export function registerTerminalPermissionPrompt(bridge: PermissionBridge): () => void {
  return bridge.registerHandler(async (request: PermissionRequest) => {
    const sink = getReplUiSink();
    if (sink?.requestPermission) {
      const ok = await sink.requestPermission({
        toolName: request.toolName,
        description: request.description,
      });
      return ok ? "approve" : "deny";
    }
    return promptReadline(request);
  });
}
