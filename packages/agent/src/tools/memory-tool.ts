import path from "node:path";
import { MemoryStore } from "../session/memory-store.js";
import type { ToolContext, ToolDefinition } from "../harness/types.js";

/**
 * Memory tool — surfaces the project memory store to the agent
 * (C3 part 2). Three actions:
 *
 *   read   — return all notes for the current project, newest
 *            first, truncated to 8KB.
 *   append — write a timestamped note. The note should be a
 *            short, declarative fact ("use pnpm, not npm") —
 *            not a transcript. Long notes are fine; the file
 *            is append-only markdown.
 *   search — substring search with 1-line context. Cheap, just
 *            a grep.
 *
 * The tool is intentionally read-mostly-write-sometimes. The
 * `append` action requires `acceptEdits` (it's a file write).
 * `read` and `search` are read-only and pre-approved.
 */
export function buildMemoryTool(
  store: MemoryStore = new MemoryStore(),
  project: string = path.basename(process.cwd()),
): ToolDefinition {
  return {
    name: "Memory",
    description:
      "Cross-session memory for this project. Actions: read (all notes, truncated), append (write a timestamped fact), search (substring, case-insensitive). The project name is the cwd basename; the same notes are visible to any session in the same project.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["read", "append", "search"],
        },
        note: {
          type: "string",
          description: 'For "append": the fact to record.',
        },
        query: {
          type: "string",
          description: 'For "search": the substring to find.',
        },
      },
      required: ["action"],
    },
    // Memory reads are safe; appends are a write — needs approval
    // under acceptEdits / default, auto-allowed under bypass.
    isReadOnly: false,
    needsPermission: true,
    execute: async (input: unknown, _ctx: ToolContext) => {
      const i = input as { action?: string; note?: string; query?: string };
      if (i.action === "append") {
        if (!i.note || !i.note.trim()) {
          return { content: "append: note is required", isError: true };
        }
        const size = store.append(project, i.note);
        return { content: `Appended to ~/.m3/memory/${project}.md (file now ${size} bytes).` };
      }
      if (i.action === "search") {
        if (!i.query) return { content: "search: query is required", isError: true };
        const hits = store.search(project, i.query);
        if (hits.length === 0) return { content: "no matches" };
        return { content: `${hits.length} match(es):\n${hits.join("\n---\n")}` };
      }
      if (i.action === "read") {
        const content = store.readAll(project);
        if (!content) return { content: "(no memory notes for this project yet)" };
        return { content };
      }
      return { content: `unknown action: ${i.action}`, isError: true };
    },
  };
}
