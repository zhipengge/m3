import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadSkills, parseSkillFile } from "./loader.js";
import { buildSkillsSystemPrompt, buildSkillTool } from "./skill-tool.js";

describe("SKILL.md parsing", () => {
  it("parses frontmatter and body (Claude Code shape)", () => {
    const { meta, body } = parseSkillFile(
      ['---', 'name: pdf', 'description: "Work with PDFs"', '---', '', 'Do the thing.'].join("\n"),
    );
    expect(meta.name).toBe("pdf");
    expect(meta.description).toBe("Work with PDFs");
    expect(body).toBe("Do the thing.");
  });

  it("treats files without frontmatter as body-only", () => {
    const { meta, body } = parseSkillFile("just instructions");
    expect(meta).toEqual({});
    expect(body).toBe("just instructions");
  });
});

describe("skill loader + tool", () => {
  it("loads skills from disk and exposes them via the Skill tool", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "m3-skills-"));
    await mkdir(path.join(dir, "greeter"));
    await writeFile(
      path.join(dir, "greeter", "SKILL.md"),
      ["---", "name: greeter", "description: Greet users warmly", "---", "Say hello nicely."].join(
        "\n",
      ),
    );

    const skills = await loadSkills([dir]);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("greeter");

    const prompt = buildSkillsSystemPrompt(skills);
    expect(prompt).toContain("greeter: Greet users warmly");

    const tool = buildSkillTool(skills);
    const ok = await tool.execute({ name: "greeter" }, {} as never);
    expect(ok.content).toContain("Say hello nicely.");

    const missing = await tool.execute({ name: "nope" }, {} as never);
    expect(missing.isError).toBe(true);
  });

  it("skips skills missing a description", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "m3-skills-"));
    await writeFile(
      path.join(dir, "SKILL.md"),
      ["---", "name: nodesc", "---", "body"].join("\n"),
    );
    const skills = await loadSkills([dir]);
    expect(skills).toHaveLength(0);
  });
});
