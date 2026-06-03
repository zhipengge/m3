#!/usr/bin/env node
/**
 * End-to-end verification script for m3 gateway + agent.
 * Usage: node scripts/verify-e2e.mjs [--live-agent]
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import WebSocket from "ws";

const GATEWAY_URL = process.env.M3_GATEWAY_URL ?? "http://127.0.0.1:18790";
const WS_URL = GATEWAY_URL.replace(/^http/, "ws");
const LIVE = process.argv.includes("--live-agent");

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

function wsRequest(method, params) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const id = `verify-${Date.now()}`;
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "req", id, method, params }));
    });
    ws.on("message", (raw) => {
      const frame = JSON.parse(raw.toString());
      if (frame.type === "res" && frame.id === id) {
        ws.close();
        resolve(frame);
      }
    });
    ws.on("error", reject);
    setTimeout(() => reject(new Error("ws timeout")), 8000).unref();
  });
}

async function main() {
  const results = [];

  // 1. doctor
  const doctor = await run("m3", ["doctor"]);
  results.push({ name: "doctor", ok: doctor.code === 0 && doctor.out.includes("Doctor: OK") });

  // 2. ensure port free
  await run("m3", ["gateway", "stop"]);

  // 3. start gateway mock
  const gw = spawn("m3", ["gateway", "--mock"], { stdio: ["ignore", "pipe", "pipe"] });
  let gwReady = false;
  gw.stdout.on("data", (d) => {
    if (d.toString().includes("listening")) gwReady = true;
  });
  for (let i = 0; i < 20 && !gwReady; i++) await sleep(200);
  results.push({ name: "gateway start", ok: gwReady });

  // 4. http health
  const healthRes = await fetch(`${GATEWAY_URL}/health`);
  const health = await healthRes.json();
  results.push({ name: "http /health", ok: health.ok === true });

  // 5. ws health
  const wsHealth = await wsRequest("health");
  results.push({ name: "ws health", ok: wsHealth.ok === true });

  // 6. ws channels.status
  const ch = await wsRequest("channels.status");
  results.push({
    name: "ws channels.status",
    ok: ch.ok === true && Array.isArray(ch.payload?.channels),
  });

  // 7. mock agent CLI
  const agentMock = await run("m3", ["agent", "--mock", "-p", "ping"]);
  results.push({
    name: "agent --mock",
    ok: agentMock.code === 0 && agentMock.out.includes("[mock]"),
  });

  // 8. duplicate output check
  results.push({
    name: "agent output not duplicated",
    ok: (agentMock.out.match(/\[mock\] Received: ping/g) ?? []).length === 1,
  });

  // 9. port conflict message
  const conflict = await run("m3", ["gateway", "--mock"]);
  results.push({
    name: "port conflict hint",
    ok: conflict.code === 1 && conflict.err.includes("m3 gateway stop"),
  });

  // 10. live agent (optional)
  if (LIVE) {
    const live = await run("m3", ["agent", "-p", "回复 OK"]);
    results.push({ name: "agent live deepseek", ok: live.code === 0 && live.out.trim().length > 0 });
  }

  gw.kill("SIGTERM");
  await sleep(500);

  console.log("\nm3 E2E verification\n");
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
