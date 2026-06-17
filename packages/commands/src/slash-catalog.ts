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
  { name: "cost", summary: "Token / USD spend (cap via agent.costCapUsd)", usage: "/cost [continue]", category: "Flow" },
  { name: "retry", summary: "Resend the last user message", usage: "/retry", category: "Flow" },
  { name: "quit", summary: "Exit the REPL (alias: /exit)", usage: "/quit", category: "Core" },
  { name: "exit", summary: "Exit the REPL (alias: /quit)", usage: "/exit", category: "Core" },
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

/**
 * Fuzzy-match score: a higher number means a better match. Returns
 * `null` when `query` characters can't be found as an ordered
 * subsequence of `name` (case-insensitive).
 *
 * The scoring rewards:
 *   - Exact match (e.g. "/clear" → /clear, +100)
 *   - Prefix match (e.g. "/cl" → /clear, /clear-undo, +30)
 *   - Consecutive character runs (typing `/mp` should beat `/mop`
 *     for the same target because the matched chars are adjacent)
 *   - A name boundary at the start of the match (word-start bonus:
 *     a match starting at index 0 or right after `-`/`_` is more
 *     likely to be what the user typed than a match in the middle)
 *
 * This is intentionally simple — we don't need a full Smith-Waterman
 * here, the spec list is small and the user is typing 1-3 chars at a
 * time. Returns null on no match so callers can use the result for
 * sort key + filter in one pass.
 */
export function fuzzyScore(name: string, query: string): number | null {
  if (!query) return 1; // empty query matches everything, base score
  const n = name.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  let score = 0;
  let prevMatchAt = -2;
  for (let i = 0; i < n.length && qi < q.length; i++) {
    if (n[i] === q[qi]) {
      // Word-start bonus: matching at the very beginning of the
      // name OR right after a separator is the strongest signal.
      const atWordStart = i === 0 || n[i - 1] === "-" || n[i - 1] === "_";
      if (atWordStart) score += 20;
      // Consecutive-run bonus: adjacent matched chars beat
      // scattered ones. The bonus is multiplicative on the word-
      // start bonus so a "perfect" prefix still wins over a
      // mid-string scattered match.
      if (i === prevMatchAt + 1) score += 15;
      prevMatchAt = i;
      qi++;
    }
  }
  if (qi < q.length) return null; // not all query chars consumed
  // Exact-match bonus: query is the full name (or a prefix of it).
  if (n === q) score += 100;
  else if (n.startsWith(q)) score += 30;
  return score;
}

/** Tab-completion candidates for a REPL line starting with /. */
export function completeSlashLine(line: string, extraNames: string[] = []): string[] {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("/")) return [];

  const partial = trimmed.slice(1).toLowerCase();
  const specs = getSlashCommandSpecs(extraNames);

  return specs
    .map((s) => ({ name: s.name, score: fuzzyScore(s.name, partial) ?? -1 }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((x) => `/${x.name}`);
}

export function formatSlashCommandMenu(filter = "", extraNames: string[] = []): string {
  const partial = filter.replace(/^\//, "").toLowerCase();
  const specs = getSlashCommandSpecs(extraNames)
    .map((s) => ({ spec: s, score: fuzzyScore(s.name, partial) ?? -1 }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.spec.name.localeCompare(b.spec.name))
    .map((x) => x.spec);

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
