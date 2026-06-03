import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expandHome } from "@m3/config";
import { DEFAULT_LLAMA_CTX_SIZE, SERVER_PID_PATH } from "./constants.js";
import { findLlamaServerBinary } from "./llama-binary.js";
import { loadLocalState } from "./state.js";
import type { LocalState } from "./types.js";

export function getServerBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}/v1`;
}

export async function checkServerHealth(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    return res.ok;
  } catch {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: controller.signal });
      return res.ok;
    } catch {
      return false;
    }
  } finally {
    clearTimeout(timer);
  }
}

function readPidFile(): number | null {
  const pidPath = expandHome(SERVER_PID_PATH);
  if (!fs.existsSync(pidPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(pidPath, "utf8")) as { pid?: number };
    return typeof raw.pid === "number" ? raw.pid : null;
  } catch {
    return null;
  }
}

function writePidFile(pid: number, port: number): void {
  const pidPath = expandHome(SERVER_PID_PATH);
  fs.mkdirSync(path.dirname(pidPath), { recursive: true });
  fs.writeFileSync(pidPath, JSON.stringify({ pid, port, startedAt: new Date().toISOString() }, null, 2));
}

function clearPidFile(): void {
  const pidPath = expandHome(SERVER_PID_PATH);
  if (fs.existsSync(pidPath)) fs.unlinkSync(pidPath);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function resolveModelPaths(state: LocalState): { llm: string; mmproj?: string } {
  const modelDir = expandHome(state.modelDir);
  const llm = path.join(modelDir, state.llmFile);
  const mmproj = state.mmprojFile ? path.join(modelDir, state.mmprojFile) : undefined;
  return { llm, mmproj };
}

export async function startLlamaServer(
  state: LocalState,
  onLog?: (line: string) => void,
): Promise<{ pid: number; port: number }> {
  if (await checkServerHealth(state.serverPort)) {
    onLog?.(`llama-server already listening on :${state.serverPort}`);
    const pid = readPidFile();
    return { pid: pid ?? 0, port: state.serverPort };
  }

  const existingPid = readPidFile();
  if (existingPid && isProcessAlive(existingPid)) {
    onLog?.(`Stopping stale llama-server (pid ${existingPid})…`);
    try {
      process.kill(existingPid, "SIGTERM");
    } catch {
      /* ignore */
    }
    clearPidFile();
  }

  const binary =
    fs.existsSync(state.llamaServerPath) ? state.llamaServerPath : findLlamaServerBinary(expandHome("~/.m3/runtime/llama.cpp"));
  if (!binary || !fs.existsSync(binary)) {
    throw new Error("llama-server binary missing. Run: m3 local");
  }

  const { llm, mmproj } = resolveModelPaths(state);
  if (!fs.existsSync(llm)) {
    throw new Error(`Model file missing: ${llm}. Run: m3 local download`);
  }
  if (state.vision && (!mmproj || !fs.existsSync(mmproj))) {
    throw new Error(`mmproj missing for vision model under ${expandHome(state.modelDir)}. Run: m3 local download`);
  }

  const ctxSize = state.ctxSize ?? DEFAULT_LLAMA_CTX_SIZE;
  onLog?.(`Starting llama-server on :${state.serverPort} (ctx-size=${ctxSize})…`);

  const args = [
    "-m",
    llm,
    "--host",
    "127.0.0.1",
    "--port",
    String(state.serverPort),
    "--ctx-size",
    String(ctxSize),
    "--parallel",
    "2",
  ];
  if (mmproj) {
    args.splice(2, 0, "--mmproj", mmproj);
  }

  const child = spawn(binary, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  if (!child.pid) {
    throw new Error("Failed to spawn llama-server");
  }
  writePidFile(child.pid, state.serverPort);

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (await checkServerHealth(state.serverPort)) {
      onLog?.(`llama-server ready (pid ${child.pid}) — ${getServerBaseUrl(state.serverPort)}`);
      return { pid: child.pid, port: state.serverPort };
    }
    await sleep(1500);
  }

  throw new Error("llama-server did not become healthy within 120s (check ~/.m3/llama-server.pid)");
}

export function stopLlamaServer(): boolean {
  const pid = readPidFile();
  if (!pid) return false;
  if (!isProcessAlive(pid)) {
    clearPidFile();
    return false;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* ignore */
  }
  clearPidFile();
  return true;
}

export async function ensureLocalInferenceServer(onLog?: (line: string) => void): Promise<void> {
  const state = loadLocalState();
  if (!state) {
    throw new Error('Local model not set up. Run: m3 local');
  }
  if (await checkServerHealth(state.serverPort)) return;
  await startLlamaServer(state, onLog);
}

export function modelFilesReady(state: LocalState): boolean {
  const { llm, mmproj } = resolveModelPaths(state);
  if (!fs.existsSync(llm)) return false;
  if (state.vision) return Boolean(mmproj && fs.existsSync(mmproj));
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Kill server if our pid file points to a live process. */
export function forceStopIfOwned(): void {
  const pid = readPidFile();
  if (pid && isProcessAlive(pid)) {
    try {
      execSync(`kill ${pid}`, { stdio: "ignore" });
    } catch {
      /* ignore */
    }
  }
  clearPidFile();
}
