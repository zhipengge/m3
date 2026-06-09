/**
 * Build a one-line human description of a tool call's input, for use in
 * permission prompts. The TUI shows this verbatim so the user can see
 * what the model is about to do, so the goal is "concrete and short":
 *
 *   Bash  + {command: "pnpm test"}     → "Bash: pnpm test"
 *   Read  + {file_path: "src/a.ts"}    → "Read: src/a.ts"
 *   Edit  + {file_path: "src/a.ts"}    → "Edit: src/a.ts"
 *   Grep  + {pattern: "TODO"}          → "Grep: TODO"
 *
 * For unknown tools the legacy `Execute <name>` is used. The full input
 * is also captured in the audit log via `summarizeInput`, so we don't
 * need to be exhaustive here — just informative enough to approve or
 * deny in one glance.
 */
export function describeToolCall(toolName: string, input: unknown): string {
  const obj = (typeof input === "object" && input !== null ? input : {}) as Record<
    string,
    unknown
  >;
  const truncate = (s: string, max = 200) => (s.length > max ? `${s.slice(0, max)}…` : s);
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  const filePath = str(obj.file_path) ?? str(obj.path);

  switch (toolName) {
    case "Bash": {
      const command = str(obj.command);
      return command ? `Bash: ${truncate(command)}` : "Bash: <no command>";
    }
    case "Read":
      return filePath ? `Read: ${truncate(filePath)}` : "Read: <no path>";
    case "Write":
      return filePath ? `Write: ${truncate(filePath)}` : "Write: <no path>";
    case "Edit":
      return filePath ? `Edit: ${truncate(filePath)}` : "Edit: <no path>";
    case "Grep": {
      const pattern = str(obj.pattern);
      return pattern ? `Grep: ${truncate(pattern)}` : "Grep: <no pattern>";
    }
    case "Glob": {
      const pattern = str(obj.glob_pattern);
      return pattern ? `Glob: ${truncate(pattern)}` : "Glob: <no pattern>";
    }
    case "WebSearch": {
      const query = str(obj.query);
      return query ? `WebSearch: ${truncate(query)}` : "WebSearch: <no query>";
    }
    default:
      return `Execute ${toolName}`;
  }
}
