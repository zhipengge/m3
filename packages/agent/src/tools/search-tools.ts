import fs from "node:fs/promises";
import fg from "fast-glob";
import { z } from "zod";
import type { ToolDefinition } from "../harness/types.js";
import { resolveWithinWorkspace } from "../security/workspace.js";

const GlobInput = z.object({
  pattern: z.string(),
  path: z.string().optional(),
});

export const globTool: ToolDefinition = {
  name: "Glob",
  description: "Find files matching a glob pattern.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob pattern e.g. **/*.ts" },
      path: { type: "string", description: "Directory to search (default cwd)" },
    },
    required: ["pattern"],
  },
  isReadOnly: true,
  isConcurrencySafe: true,
  execute: async (raw, ctx) => {
    const input = GlobInput.parse(raw);
    const cwd = input.path
      ? resolveWithinWorkspace(ctx.cwd, input.path, ctx.sandbox, { readOnly: true })
      : ctx.cwd;
    const matches = await fg(input.pattern, { cwd, absolute: true, dot: false });
    return { content: matches.length ? matches.join("\n") : "No matches" };
  },
};

const GrepInput = z.object({
  pattern: z.string(),
  path: z.string().optional(),
  glob: z.string().optional(),
  case_insensitive: z.boolean().optional(),
});

export const grepTool: ToolDefinition = {
  name: "Grep",
  description: "Search file contents for a regex pattern.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      path: { type: "string" },
      glob: { type: "string", description: "Filter files e.g. *.ts" },
      case_insensitive: { type: "boolean" },
    },
    required: ["pattern"],
  },
  isReadOnly: true,
  isConcurrencySafe: true,
  execute: async (raw, ctx) => {
    const input = GrepInput.parse(raw);
    const searchDir = input.path
      ? resolveWithinWorkspace(ctx.cwd, input.path, ctx.sandbox, { readOnly: true })
      : ctx.cwd;

    const flags = input.case_insensitive ? "i" : "";
    const regex = new RegExp(input.pattern, flags);
    const files = await fg(input.glob ?? "**/*", {
      cwd: searchDir,
      absolute: true,
      dot: false,
      ignore: ["**/node_modules/**", "**/.git/**"],
    });

    const hits: string[] = [];
    for (const file of files.slice(0, 500)) {
      try {
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > 2_000_000) continue;
        const content = await fs.readFile(file, "utf8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i]!)) {
            hits.push(`${file}:${i + 1}:${lines[i]}`);
            if (hits.length >= 100) break;
          }
        }
      } catch {
        // skip binary/unreadable
      }
      if (hits.length >= 100) break;
    }

    return { content: hits.length ? hits.join("\n") : "No matches" };
  },
};
