import fs from "node:fs";
import path from "node:path";
import { atomicWriteFileSync, expandHome } from "@m3/config";

/**
 * Cross-session memory store (C3).
 *
 * Each project (cwd basename) gets an append-only markdown file
 * at \`~/.m3/memory/<project>.md\`. Any session for that project
 * can read / append / search the file, so a "we decided to use
 * pnpm, not npm" note written yesterday shows up automatically
 * on the next session of the same project — across machines, if
 * the file is in a shared home directory.
 *
 * The store is intentionally dumb: markdown on disk, grep for
 * search. No vector index, no DB, no LLM-driven summarization.
 * The point is "any session can read what any previous session
 * thought" without a knowledge-engineering project.
 */
export class MemoryStore {
  constructor(private readonly basePath: string = "~/.m3/memory") {}

  private filePath(project: string): string {
    return path.join(expandHome(this.basePath), `${project}.md`);
  }

  /** Append a timestamped note. Returns the resulting file size. */
  append(project: string, note: string): number {
    const fp = this.filePath(project);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const stamp = new Date().toISOString();
    const entry = `\n## ${stamp}\n\n${note.trim()}\n`;
    // Append is not atomic in the strict sense, but the entry
    // is small and the file is append-only; a torn write would
    // only lose the last line. fs.appendFileSync is O_APPEND
    // so concurrent writers serialize at the filesystem level.
    fs.appendFileSync(fp, entry);
    return fs.statSync(fp).size;
  }

  /** Read all notes for a project, newest first. Truncates to
   *  \`maxBytes\` so the system-prompt injection stays bounded. */
  readAll(project: string, maxBytes: number = 8_000): string {
    const fp = this.filePath(project);
    if (!fs.existsSync(fp)) return "";
    const stat = fs.statSync(fp);
    if (stat.size <= maxBytes) {
      return fs.readFileSync(fp, "utf8");
    }
    // Newest notes are at the end of the file (we always
    // append). Take the tail and prefix a marker.
    const fd = fs.openSync(fp, "r");
    try {
      const buf = Buffer.alloc(maxBytes);
      fs.readSync(fd, buf, 0, maxBytes, stat.size - maxBytes);
      return `[…earlier notes truncated…]\n\n${buf.toString("utf8")}`;
    } finally {
      fs.closeSync(fd);
    }
  }

  /** Substring search across all notes for a project. Returns
   *  the lines (with surrounding 1-line context) that contain
   *  the query, case-insensitive. */
  search(project: string, query: string): string[] {
    const fp = this.filePath(project);
    if (!fs.existsSync(fp)) return [];
    const lines = fs.readFileSync(fp, "utf8").split("\n");
    const q = query.toLowerCase();
    const hits: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.toLowerCase().includes(q)) {
        // Show this line + 1 before + 1 after for context.
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length, i + 2);
        hits.push(lines.slice(start, end).join("\n"));
      }
    }
    return hits;
  }

  /** Atomic snapshot: write a fresh file from \`content\`. Used
   *  by the Memory tool's \`compact\` action to dedupe a long
   *  file. */
  overwrite(project: string, content: string): void {
    const fp = this.filePath(project);
    atomicWriteFileSync(fp, content);
  }

  /** List all memory projects (file basenames in the memory dir). */
  listProjects(): string[] {
    const dir = expandHome(this.basePath);
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((n) => n.endsWith(".md"))
      .map((n) => n.replace(/\.md$/, ""));
  }
}
