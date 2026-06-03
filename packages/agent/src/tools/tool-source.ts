import type { AgentConfig } from "@m3/config";
import type { ToolDefinition } from "../harness/types.js";
import { loadSkills } from "../skills/loader.js";
import { buildSkillTool, buildSkillsSystemPrompt } from "../skills/skill-tool.js";
import { mcpToolProvider } from "../mcp/provider.js";
import { getTools as getBuiltinTools } from "./registry.js";

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
 * Aggregate tools from all providers. Builtin and skills first, then any
 * registered external providers (MCP/plugins). Names are de-duplicated with
 * earlier providers winning so core tools can't be shadowed.
 */
export async function collectTools(config: AgentConfig): Promise<CollectedTools> {
  const providers = [builtinProvider, skillsProvider, ...externalProviders];
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
  if (config.permissionMode === "plan") {
    collected = collected.filter((t) => t.isReadOnly);
  }
  return { tools: collected, systemPrompt: prompts.join("\n\n") };
}
