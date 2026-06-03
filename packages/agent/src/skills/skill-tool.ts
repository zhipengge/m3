import { z } from "zod";
import type { ToolDefinition } from "../harness/types.js";
import type { LoadedSkill } from "./loader.js";

const SkillInput = z.object({
  name: z.string(),
});

/**
 * Build the `Skill` tool from loaded skills, using Claude Code / Cursor-style
 * progressive disclosure: the system prompt advertises skill names +
 * descriptions; the model invokes this tool to pull the full instructions on
 * demand. Read-only and concurrency-safe (it only returns text).
 */
export function buildSkillTool(skills: LoadedSkill[]): ToolDefinition {
  const byName = new Map(skills.map((s) => [s.name, s]));
  return {
    name: "Skill",
    description:
      "Load the full instructions for a named skill. Call this when a user request " +
      "matches one of the available skills listed in the system prompt.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "The skill name to load" },
      },
      required: ["name"],
    },
    isReadOnly: true,
    isConcurrencySafe: true,
    execute: async (raw) => {
      const { name } = SkillInput.parse(raw);
      const skill = byName.get(name);
      if (!skill) {
        const available = [...byName.keys()].join(", ") || "(none)";
        return { content: `Unknown skill "${name}". Available: ${available}`, isError: true };
      }
      return { content: `# Skill: ${skill.name}\n\n${skill.body}` };
    },
  };
}

/** System prompt fragment advertising available skills (progressive disclosure). */
export function buildSkillsSystemPrompt(skills: LoadedSkill[]): string {
  if (skills.length === 0) return "";
  const lines = skills.map((s) => `- ${s.name}: ${s.description}`);
  return [
    "## Available Skills",
    "When a request matches one of these skills, call the `Skill` tool with its name to load full instructions before proceeding:",
    ...lines,
  ].join("\n");
}
