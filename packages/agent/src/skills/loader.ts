import fs from "node:fs/promises";
import path from "node:path";

export type LoadedSkill = {
  /** Skill identifier (frontmatter `name`, falling back to the directory name). */
  name: string;
  /** When to use this skill — shown to the model for progressive disclosure. */
  description: string;
  /** Full SKILL.md body (instructions), loaded on demand. */
  body: string;
  /** Absolute path to the SKILL.md file. */
  path: string;
};

/**
 * Minimal YAML frontmatter parser — intentionally tiny (no js-yaml dep) and
 * compatible with the Claude Code `SKILL.md` shape:
 *
 *   ---
 *   name: my-skill
 *   description: When to use this skill
 *   ---
 *   <markdown body>
 */
export function parseSkillFile(content: string): { meta: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) return { meta: {}, body: content.trim() };

  const meta: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    let value = kv[2]!.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    meta[kv[1]!.toLowerCase()] = value;
  }
  return { meta, body: (match[2] ?? "").trim() };
}

async function findSkillFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toUpperCase() === "SKILL.MD") {
      out.push(full);
    } else if (entry.isDirectory()) {
      const nested = path.join(full, "SKILL.md");
      try {
        const stat = await fs.stat(nested);
        if (stat.isFile()) out.push(nested);
      } catch {
        // no SKILL.md in this subdir
      }
    }
  }
  return out;
}

/** Scan configured directories for SKILL.md files (Claude Code compatible). */
export async function loadSkills(dirs: string[]): Promise<LoadedSkill[]> {
  const skills: LoadedSkill[] = [];
  const seen = new Set<string>();

  for (const dir of dirs) {
    const files = await findSkillFiles(dir);
    for (const file of files) {
      try {
        const content = await fs.readFile(file, "utf8");
        const { meta, body } = parseSkillFile(content);
        const name = meta.name || path.basename(path.dirname(file));
        if (!meta.description || seen.has(name)) continue;
        seen.add(name);
        skills.push({ name, description: meta.description, body, path: file });
      } catch {
        // skip unreadable skill
      }
    }
  }
  return skills;
}
