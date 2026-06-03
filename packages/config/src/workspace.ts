import path from "node:path";
import type { AgentConfig } from "./schema.js";
import { expandHome } from "./schema.js";

/** Effective workspace root for file/bash tools (launch cwd unless agent.cwd is set). */
export function resolveAgentWorkspace(
  agent: Pick<AgentConfig, "cwd">,
  launchCwd: string = process.cwd(),
): string {
  const configured = agent.cwd?.trim();
  return configured ? path.resolve(expandHome(configured)) : path.resolve(launchCwd);
}
