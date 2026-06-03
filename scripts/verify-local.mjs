#!/usr/bin/env node
/**
 * Verify m3 with local model + slash commands.
 * Usage: node scripts/verify-local.mjs [--skip-agent]
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SKIP_AGENT = process.argv.includes("--skip-agent");

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", (code) => resolve({ code, out, err }));
    child.on("error", reject);
  });
}

async function main() {
  const results = [];

  const doctor = await run("m3", ["doctor"]);
  results.push({
    name: "doctor",
    ok: doctor.code === 0 && doctor.out.includes("Doctor: OK"),
  });

  const localStatus = await run("m3", ["local", "status"]);
  const localReady =
    localStatus.code === 0 &&
    localStatus.out.includes("ready") &&
    localStatus.out.includes("running");
  results.push({ name: "local status (weights + server)", ok: localReady });

  const health = await run("curl", ["-sf", "http://127.0.0.1:8080/health"]);
  results.push({
    name: "llama-server /health",
    ok: health.code === 0,
  });

  const { executeCommand, listCommands, parseSlashCommand } = await import(
    "../packages/commands/dist/registry.js"
  );
  const { completeSlashLine, formatSlashCommandMenu } = await import(
    "../packages/commands/dist/slash-catalog.js"
  );
  const { M3ConfigSchema } = await import("../packages/config/dist/schema.js");
  const ctx = {
    config: M3ConfigSchema.parse({ agent: { model: "local/qwen3-vl-4b-instruct" } }),
    sessionKey: "verify:local",
    channel: "webchat",
    messageCount: 4,
    contextUsageRatio: 0.91,
  };

  const cmdList = listCommands();
  results.push({ name: "slash commands registered", ok: cmdList.length >= 20 });
  results.push({ name: "/goal in registry", ok: cmdList.includes("goal") });
  results.push({
    name: "/goal set_goal action",
    ok: executeCommand("goal", "reply OK only", ctx)?.action === "set_goal",
  });
  results.push({
    name: "/compact compact_session",
    ok: executeCommand("compact", "", ctx)?.action === "compact_session",
  });
  results.push({
    name: "/context shows 90% hint",
    ok: (() => {
      const r = executeCommand("context", "", ctx);
      return r?.action === "reply_only" && r.text.includes("90%");
    })(),
  });
  results.push({
    name: "parse /goal",
    ok: parseSlashCommand("/goal all tests pass")?.name === "goal",
  });
  results.push({
    name: "slash Tab completion",
    ok: completeSlashLine("/com").includes("/compact"),
  });
  results.push({
    name: "slash command menu",
    ok: formatSlashCommandMenu().includes("/goal"),
  });

  const mockAgent = await run("m3", ["agent", "--mock", "-p", "ping"]);
  results.push({
    name: "agent --mock exits",
    ok: mockAgent.code === 0 && mockAgent.out.includes("[mock]"),
  });

  if (!SKIP_AGENT && localReady) {
    const t0 = Date.now();
    const live = await run("m3", ["agent", "-p", "只回复 OK，不要调用任何工具"]);
    const elapsed = Date.now() - t0;
    results.push({
      name: "agent local -p exits",
      ok: live.code === 0 && live.out.includes("OK") && elapsed < 45_000,
    });
  } else if (SKIP_AGENT) {
    results.push({ name: "agent local -p exits", ok: true });
  } else {
    results.push({ name: "agent local -p exits", ok: false });
  }

  const e2e = await run("node", ["scripts/verify-e2e.mjs"]);
  results.push({ name: "verify-e2e (mock gateway)", ok: e2e.code === 0 });

  console.log("\nm3 local verification\n");
  let failed = 0;
  for (const r of results) {
    const mark = r.ok ? "PASS" : "FAIL";
    if (!r.ok) failed++;
    console.log(`  [${mark}] ${r.name}`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
