/** Metadata for REPL slash-command hints and tab completion. */
export type SlashCommandSpec = {
  name: string;
  summary: string;
  usage: string;
};

export const SLASH_COMMAND_SPECS: SlashCommandSpec[] = [
  { name: "help", summary: "List slash commands", usage: "/help" },
  {
    name: "thinking",
    summary: "Toggle reasoning display (Ctrl+O in Ink REPL)",
    usage: "/thinking [toggle|expand|collapse]",
  },
  { name: "status", summary: "Session, model, and context usage", usage: "/status" },
  { name: "context", summary: "Context window fill ratio (auto-compress at 90%)", usage: "/context" },
  { name: "clear", summary: "Clear session transcript", usage: "/clear" },
  { name: "reset", summary: "Alias for /clear", usage: "/reset" },
  { name: "new", summary: "Alias for /clear", usage: "/new" },
  { name: "compact", summary: "Compress conversation history", usage: "/compact [focus]" },
  { name: "goal", summary: "Set or clear a session goal", usage: "/goal <condition|clear>" },
  { name: "plan", summary: "Plan mode (no destructive edits)", usage: "/plan" },
  { name: "model", summary: "Show or note model ref", usage: "/model [ref]" },
  { name: "permissions", summary: "Show permission mode", usage: "/permissions" },
  { name: "doctor", summary: "Run m3 doctor", usage: "/doctor" },
  { name: "mcp", summary: "MCP server status", usage: "/mcp" },
  { name: "skills", summary: "Skill directories", usage: "/skills" },
  { name: "agents", summary: "Sub-agent config", usage: "/agents" },
  { name: "hooks", summary: "Hooks config", usage: "/hooks" },
  { name: "memory", summary: "Project memory files", usage: "/memory" },
  { name: "review", summary: "Request code review", usage: "/review" },
  { name: "config", summary: "Show m3.json summary", usage: "/config" },
  { name: "resume", summary: "Continue prior context", usage: "/resume" },
  { name: "export", summary: "Transcript export path", usage: "/export" },
  { name: "init", summary: "Workspace init hint", usage: "/init" },
  { name: "cost", summary: "Cost / billing hint", usage: "/cost" },
];

const specByName = new Map(SLASH_COMMAND_SPECS.map((s) => [s.name, s]));

export function getSlashCommandSpecs(extraNames: string[] = []): SlashCommandSpec[] {
  const seen = new Set<string>();
  const out: SlashCommandSpec[] = [];
  for (const spec of SLASH_COMMAND_SPECS) {
    seen.add(spec.name);
    out.push(spec);
  }
  for (const name of extraNames) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      specByName.get(key) ?? {
        name: key,
        summary: "Plugin slash command",
        usage: `/${key}`,
      },
    );
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Tab-completion candidates for a REPL line starting with /. */
export function completeSlashLine(line: string, extraNames: string[] = []): string[] {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("/")) return [];

  const partial = trimmed.slice(1).toLowerCase();
  const specs = getSlashCommandSpecs(extraNames);

  return specs
    .filter((s) => !partial || s.name.startsWith(partial))
    .map((s) => `/${s.name}`);
}

export function formatSlashCommandMenu(filter = "", extraNames: string[] = []): string {
  const partial = filter.replace(/^\//, "").toLowerCase();
  const specs = getSlashCommandSpecs(extraNames).filter(
    (s) => !partial || s.name.startsWith(partial),
  );

  const nameWidth = Math.max(8, ...specs.map((s) => s.name.length + 1));
  const lines = ["Slash commands (Tab to complete, /help for details):", ""];
  for (const spec of specs) {
    lines.push(`  /${spec.name.padEnd(nameWidth)} ${spec.summary}`);
    if (spec.usage.includes(" ")) {
      lines.push(`${"".padEnd(nameWidth + 4)} ${spec.usage}`);
    }
  }
  return lines.join("\n");
}
