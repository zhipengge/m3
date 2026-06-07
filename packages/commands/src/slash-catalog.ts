/** Metadata for REPL slash-command hints and tab completion. */
export type SlashCategory =
  | "Core"      // basics — help, clear, status
  | "Mode"      // plan / model / permissions
  | "Context"   // compact, context, memory
  | "Tooling"   // mcp / skills / agents / hooks
  | "Config"    // doctor, init, config, review
  | "Flow";     // goal, resume, export, cost

export type SlashCommandSpec = {
  name: string;
  summary: string;
  usage: string;
  category: SlashCategory;
};

export const SLASH_COMMAND_SPECS: SlashCommandSpec[] = [
  { name: "help", summary: "List slash commands", usage: "/help", category: "Core" },
  {
    name: "thinking",
    summary: "Toggle reasoning display (Ctrl+O in Ink REPL)",
    usage: "/thinking [toggle|expand|collapse]",
    category: "Core",
  },
  { name: "status", summary: "Session, model, and context usage", usage: "/status", category: "Core" },
  { name: "clear", summary: "Clear session transcript", usage: "/clear", category: "Core" },
  { name: "reset", summary: "Alias for /clear", usage: "/reset", category: "Core" },
  { name: "new", summary: "Alias for /clear", usage: "/new", category: "Core" },
  { name: "context", summary: "Context window fill ratio (auto-compress at 90%)", usage: "/context", category: "Context" },
  { name: "compact", summary: "Compress conversation history", usage: "/compact [focus]", category: "Context" },
  { name: "memory", summary: "Project memory files", usage: "/memory", category: "Context" },
  { name: "plan", summary: "Plan mode (no destructive edits)", usage: "/plan", category: "Mode" },
  { name: "model", summary: "Show or note model ref", usage: "/model [ref]", category: "Mode" },
  { name: "permissions", summary: "Show permission mode", usage: "/permissions", category: "Mode" },
  { name: "mcp", summary: "MCP server status", usage: "/mcp", category: "Tooling" },
  { name: "skills", summary: "Skill directories", usage: "/skills", category: "Tooling" },
  { name: "agents", summary: "Sub-agent config", usage: "/agents", category: "Tooling" },
  { name: "hooks", summary: "Hooks config", usage: "/hooks", category: "Tooling" },
  { name: "doctor", summary: "Run m3 doctor", usage: "/doctor", category: "Config" },
  { name: "config", summary: "Show m3.json summary", usage: "/config", category: "Config" },
  { name: "review", summary: "Request code review", usage: "/review", category: "Config" },
  { name: "init", summary: "Workspace init hint", usage: "/init", category: "Config" },
  { name: "goal", summary: "Set or clear a session goal", usage: "/goal <condition|clear>", category: "Flow" },
  { name: "resume", summary: "Continue prior context", usage: "/resume", category: "Flow" },
  { name: "export", summary: "Transcript export path", usage: "/export", category: "Flow" },
  { name: "cost", summary: "Cost / billing hint", usage: "/cost", category: "Flow" },
];

/** Display order for grouped palette / help output. */
export const SLASH_CATEGORY_ORDER: SlashCategory[] = [
  "Core",
  "Mode",
  "Context",
  "Tooling",
  "Config",
  "Flow",
];

/** Group specs by category, preserving the canonical order. */
export function groupSlashCommandsByCategory(
  specs: SlashCommandSpec[],
): Array<{ category: SlashCategory; specs: SlashCommandSpec[] }> {
  const buckets = new Map<SlashCategory, SlashCommandSpec[]>();
  for (const s of specs) {
    const arr = buckets.get(s.category) ?? [];
    arr.push(s);
    buckets.set(s.category, arr);
  }
  return SLASH_CATEGORY_ORDER.filter((c) => buckets.has(c)).map((c) => ({
    category: c,
    specs: buckets.get(c)!,
  }));
}

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
    const existing = specByName.get(key);
    if (existing) {
      out.push(existing);
    } else {
      // Plugin-provided commands don't have a category; bucket them
      // under "Core" so the palette still groups sensibly.
      out.push({
        name: key,
        summary: "Plugin slash command",
        usage: `/${key}`,
        category: "Core",
      });
    }
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
