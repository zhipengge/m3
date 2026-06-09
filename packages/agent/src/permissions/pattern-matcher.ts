/**
 * Pattern matcher for `agent.permissions.allow` and
 * `agent.permissions.deny` (B10).
 *
 * Pattern grammar:
 *   - "Read"              — exact name match (input ignored)
 *   - "Read(/path/*)"     — name match + input substring match
 *   - "Bash(/regex/i)"    — name match + input regex match
 *
 * The input is matched as a JSON string (the same string the
 * tool_use input would serialize to). The substring variant
 * supports `*` as a wildcard that matches anything (no other
 * regex characters have meaning).
 *
 * Examples:
 *   "Read"                            matches every Read call
 *   "Read(/home/user/*)"              matches Read of /home/user/...
 *   "Bash(npm test:*)"                matches Bash whose input contains "npm test"
 *   "Bash(/rm\\s+-rf\\s+\\//)"        matches Bash running rm -rf /
 *
 * The matcher is intentionally simple: a permissions policy that
 * tries to express anything more nuanced belongs in a custom
 * plugin or a hooks-based approach. The goal is to give a user
 * a single-file, read-friendly way to lock down the LLM.
 */

export type PatternMatch =
  | { kind: "no-match" }
  | { kind: "name-only" }
  | { kind: "input-match"; via: "substring" | "regex" };

/** Try to match a pattern against a tool name + its input. */
export function matchPattern(
  pattern: string,
  toolName: string,
  input: unknown,
): PatternMatch {
  // "Bash(...)" — name plus input filter. Extract the part inside parens.
  const parenIdx = pattern.indexOf("(");
  if (parenIdx > 0 && pattern.endsWith(")")) {
    const name = pattern.slice(0, parenIdx);
    if (name !== toolName) return { kind: "no-match" };
    const filter = pattern.slice(parenIdx + 1, -1);
    const inputStr = serializeInput(input);
    // Regex form: /pattern/flags
    const reMatch = /^\/(.+)\/([gimsuy]*)$/.exec(filter);
    if (reMatch) {
      try {
        const re = new RegExp(reMatch[1]!, reMatch[2]);
        return re.test(inputStr)
          ? { kind: "input-match", via: "regex" }
          : { kind: "no-match" };
      } catch {
        return { kind: "no-match" };
      }
    }
    // Substring form (with * wildcards).
    if (filter.includes("*")) {
      // Escape regex specials except *, convert * to .*
      const parts = filter.split("*").map(escapeRegex);
      const re = new RegExp(parts.join(".*"));
      return re.test(inputStr)
        ? { kind: "input-match", via: "substring" }
        : { kind: "no-match" };
    }
    return inputStr.includes(filter)
      ? { kind: "input-match", via: "substring" }
      : { kind: "no-match" };
  }
  // Bare name match.
  return pattern === toolName ? { kind: "name-only" } : { kind: "no-match" };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function serializeInput(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

/**
 * High-level: does any pattern in the list match this tool call?
 * Returns the *first* match (in list order). Used by the
 * PermissionManager to short-circuit before the normal ask flow.
 */
export function findMatchingPattern(
  patterns: string[],
  toolName: string,
  input: unknown,
): { pattern: string; match: PatternMatch } | null {
  for (const p of patterns) {
    const m = matchPattern(p, toolName, input);
    if (m.kind !== "no-match") return { pattern: p, match: m };
  }
  return null;
}
