import type { AgentConfig } from "@m3/config";
import type { ToolDefinition } from "../harness/types.js";
import { loadSkills } from "../skills/loader.js";
import { buildSkillTool, buildSkillsSystemPrompt } from "../skills/skill-tool.js";
import { mcpToolProvider } from "../mcp/provider.js";
import { getTools as getBuiltinTools } from "./registry.js";
import { MemoryStore } from "../session/memory-store.js";
import { buildMemoryTool } from "./memory-tool.js";

/**
 * A ToolProvider contributes tools (and optionally system-prompt text) to the
 * harness. This is the single extension seam through which builtin tools,
 * skills, MCP servers, and plugins all flow — keeping the harness itself
 * unaware of where a tool came from.
 */
export type ToolProvider = {
  id: string;
  provide: (config: AgentConfig) => Promise<ToolContribution>;
};

export type ToolContribution = {
  tools: ToolDefinition[];
  /** Optional system-prompt fragment (e.g. skill catalog). */
  systemPrompt?: string;
};

export type CollectedTools = {
  tools: ToolDefinition[];
  systemPrompt: string;
};

const builtinProvider: ToolProvider = {
  id: "builtin",
  provide: async (config) => ({ tools: getBuiltinTools(config) }),
};

const skillsProvider: ToolProvider = {
  id: "skills",
  provide: async (config) => {
    const dirs = config.skills?.dirs ?? [];
    if (dirs.length === 0) return { tools: [] };
    const skills = await loadSkills(dirs);
    if (skills.length === 0) return { tools: [] };
    return {
      tools: [buildSkillTool(skills)],
      systemPrompt: buildSkillsSystemPrompt(skills),
    };
  },
};

/**
 * C3 part 2: a memory tool + memory system-prompt fragment. The
 * store is keyed by the workspace id (D3) — a SHA-derived
 * stable id from the absolute cwd. Two unrelated projects both
 * named "src" no longer share a memory file. Legacy basename
 * files are migrated lazily on first access.
 */
const memoryProvider: ToolProvider = {
  id: "memory",
  provide: async () => {
    const { resolveWorkspace } = await import("@m3/config");
    const store = new MemoryStore();
    const ws = resolveWorkspace();
    // Migrate a legacy basename file to the ws-id path on
    // first access. Idempotent; no-op when already migrated.
    try {
      store.migrateBasenameToWorkspaceId(ws.absPath, ws.id);
    } catch {
      /* best-effort */
    }
    const notes = store.readAll(ws.id);
    const systemPrompt = notes
      ? `\n## Cross-session memory (workspace: ${ws.label} / ${ws.id})\n\n${notes}\n`
      : "";
    return {
      tools: [buildMemoryTool(store, ws.id)],
      systemPrompt,
    };
  },
};

const externalProviders: ToolProvider[] = [mcpToolProvider];

/** Register an extra tool source (used by MCP bridge / plugins). */
export function registerToolProvider(provider: ToolProvider): void {
  if (!externalProviders.some((p) => p.id === provider.id)) {
    externalProviders.push(provider);
  }
}

function dedupeByName(tools: ToolDefinition[]): ToolDefinition[] {
  const seen = new Set<string>();
  const out: ToolDefinition[] = [];
  for (const tool of tools) {
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    out.push(tool);
  }
  return out;
}

/**
 * Enforce `config.tools` (the user-facing allowlist). When set to "*" or
 * unset, returns the input unchanged. When set to a string array, keeps
 * only tools whose name is in the list. Pattern matching (`Bash(npm:*)`)
 * is intentionally NOT supported here — use the dedicated
 * `agent.permissions.allow` rules for that.
 *
 * This is the security boundary that the `agent.tools` config field
 * promises but the harness had never enforced: previously, setting
 * `agent.tools: ["Read"]` had zero effect on the LLM, which could call
 * Bash / Edit / etc. via the registered provider path.
 */
export function applyToolAllowlist(
  tools: ToolDefinition[],
  allowlist: AgentConfig["tools"],
): ToolDefinition[] {
  if (allowlist === "*" || allowlist === undefined) return tools;
  const set = new Set(allowlist);
  const kept = tools.filter((t) => set.has(t.name));
  const dropped = tools.filter((t) => !set.has(t.name));
  if (dropped.length > 0) {
    process.stderr.write(
      `[m3:agent] agent.tools allowlist: hiding ${dropped.length} tool(s): ${dropped.map((t) => t.name).join(", ")}\n`,
    );
  }
  return kept;
}

/**
 * Aggregate tools from all providers. Builtin and skills first, then any
 * registered external providers (MCP/plugins). Names are de-duplicated with
 * earlier providers winning so core tools can't be shadowed.
 */
export async function collectTools(config: AgentConfig): Promise<CollectedTools> {
  const providers = [builtinProvider, skillsProvider, memoryProvider, ...externalProviders];
  const tools: ToolDefinition[] = [];
  const prompts: string[] = [];

  for (const provider of providers) {
    try {
      const contribution = await provider.provide(config);
      tools.push(...contribution.tools);
      if (contribution.systemPrompt) prompts.push(contribution.systemPrompt);
    } catch (err) {
      process.stderr.write(
        `[m3] tool provider "${provider.id}" failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  let collected = dedupeByName(tools);
  const hasBuiltinWrite = collected.some((t) => t.name === "Write");
  if (hasBuiltinWrite) {
    collected = collected.filter(
      (t) =>
        !t.name.endsWith("__write_file") &&
        !t.name.endsWith("__edit_file") &&
        !t.name.endsWith("__create_directory"),
    );
  }
  if (config.permissionMode === "plan") {
    collected = collected.filter((t) => t.isReadOnly);
  }
  // Apply the user-declared `agent.tools` allowlist last so it overrides
  // everything collected from providers. This is the only enforcement
  // point — executeTools() relies on the LLM never having seen a name
  // it cannot call, AND on a tool not being in the dispatch list.
  collected = applyToolAllowlist(collected, config.tools);
  return { tools: collected, systemPrompt: prompts.join("\n\n") };
}
