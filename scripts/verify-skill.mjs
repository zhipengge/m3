import { createAgentEngine } from "../packages/agent/dist/index.js";
import { loadConfig } from "../packages/config/dist/index.js";

const skillDir = process.argv[2] ?? "/tmp/m3-verify-skills";
const m3 = loadConfig();
const agent = { ...m3.agent, skills: { dirs: [skillDir] } };
const engine = createAgentEngine({ config: agent, m3Config: m3 });

let skillToolUsed = false;
let finalText = "";

for await (const evt of engine.run({
  prompt: "Please introduce the m3 framework.",
  cwd: process.cwd(),
})) {
  if (evt.type === "tool_use" && evt.name === "Skill") {
    skillToolUsed = true;
    console.log(`[event] Skill tool called with: ${JSON.stringify(evt.input)}`);
  }
  if (evt.type === "result") finalText = evt.text;
}

console.log("\n--- final answer ---\n" + finalText);
console.log("\n--- assertions ---");
console.log("Skill tool invoked:", skillToolUsed);
console.log("Marker present:", finalText.includes("<<POEM-SKILL-LOADED>>"));
process.exit(skillToolUsed && finalText.includes("<<POEM-SKILL-LOADED>>") ? 0 : 1);
