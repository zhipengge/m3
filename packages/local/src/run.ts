import fs from "node:fs";
import { expandHome } from "@m3/config";
import { DEFAULT_LLAMA_CTX_SIZE, DEFAULT_QUANT, DEFAULT_SERVER_PORT } from "./constants.js";
import { downloadModelFiles } from "./download.js";
import { ensureLlamaBinary } from "./llama-binary.js";
import { patchM3ConfigForLocal } from "./config-patch.js";
import { checkServerHealth, getServerBaseUrl, modelFilesReady, startLlamaServer, stopLlamaServer } from "./llama-server.js";
import { resolveMirrorChoice } from "./mirror.js";
import { resolveLocalModelInput, modelDirForSlug } from "./model-spec.js";
import { filenamesToDownload, resolveDownloadFiles } from "./repo-files.js";
import { loadLocalState, saveLocalState } from "./state.js";
import type { LocalSetupOptions, LocalState, LocalStatus } from "./types.js";

function log(opts: LocalSetupOptions | undefined, line: string): void {
  opts?.onLog?.(line);
  if (!opts?.onLog) console.log(line);
}

function aria2Opts(opts: LocalSetupOptions) {
  return {
    connections: opts.connections,
    concurrent: opts.concurrent,
    noAria2: opts.noAria2,
    aria2Path: opts.aria2Path,
  };
}

export async function runLocalSetup(opts: LocalSetupOptions = {}): Promise<LocalState> {
  const quant = opts.quant ?? DEFAULT_QUANT;
  const port = opts.port ?? DEFAULT_SERVER_PORT;
  const spec = resolveLocalModelInput(opts.model);
  const ctxSize = opts.ctxSize ?? spec.defaultCtxSize ?? DEFAULT_LLAMA_CTX_SIZE;

  log(opts, `m3 local — ${spec.displayName} via llama.cpp\n`);
  log(opts, `  model: ${spec.id} (${spec.repo})`);

  const mirror = await resolveMirrorChoice(opts.mirror);
  log(opts, `  mirror: ${mirror}`);

  const modelDir = expandHome(modelDirForSlug(spec.id));
  fs.mkdirSync(modelDir, { recursive: true });

  let llmFile = "";
  let mmprojFile = "";

  if (!opts.skipDownload) {
    log(opts, "\nResolving GGUF files…");
    const files = await resolveDownloadFiles(mirror, spec, quant, opts.onLog);
    llmFile = files.llm;
    mmprojFile = files.mmproj ?? "";

    log(opts, "\nDownloading…");
    await downloadModelFiles(mirror, spec.repo, filenamesToDownload(files), modelDir, {
      onLog: opts.onLog,
      ...aria2Opts(opts),
    });
  } else {
    log(opts, "\nSkipping download (--skip-download).");
    const existing = loadLocalState();
    if (existing?.modelSlug === spec.id) {
      llmFile = existing.llmFile;
      mmprojFile = existing.mmprojFile;
    } else {
      throw new Error("Cannot skip download for a new model without existing local.json state.");
    }
  }

  let llamaServerPath = loadLocalState()?.llamaServerPath ?? "";
  if (!opts.skipBinary) {
    log(opts, "\nEnsuring llama.cpp binary…");
    llamaServerPath = await ensureLlamaBinary(opts.onLog, aria2Opts(opts));
  } else if (!llamaServerPath) {
    llamaServerPath = await ensureLlamaBinary(opts.onLog, aria2Opts(opts));
  }

  const state: LocalState = {
    version: 2,
    mirror,
    quant,
    modelSlug: spec.id,
    repo: spec.repo,
    displayName: spec.displayName,
    vision: spec.vision,
    modelDir,
    llmFile,
    mmprojFile,
    serverPort: port,
    llamaServerPath,
    ctxSize,
    configuredAt: new Date().toISOString(),
  };
  saveLocalState(state);

  if (!opts.skipConfig) {
    const ref = patchM3ConfigForLocal(opts.configPath, spec, port, ctxSize);
    log(opts, `\nUpdated m3 config → default model: ${ref}`);
    log(opts, `  OpenAI-compatible endpoint: ${getServerBaseUrl(port)}`);
  }

  if (!opts.skipStart) {
    log(opts, "\nStarting llama-server…");
    await startLlamaServer(state, opts.onLog);
    log(opts, "\nLocal inference is ready.");
    log(opts, "  m3 chat          # use local model in REPL");
    log(opts, "  m3 agent -p \"…\"  # one-shot");
    log(opts, "  m3 local status  # check server");
    log(opts, "  m3 local stop    # stop llama-server");
  } else {
    log(opts, "\nSetup complete (server not started). Run: m3 local start");
  }

  return state;
}

export async function downloadLocalModelOnly(opts: LocalSetupOptions = {}): Promise<void> {
  await runLocalSetup({ ...opts, skipBinary: true, skipConfig: true, skipStart: true });
}

export async function startLocalServer(opts: { onLog?: (s: string) => void } = {}): Promise<void> {
  const state = loadLocalState();
  if (!state) throw new Error("Run m3 local first to download models and configure.");
  if (!modelFilesReady(state)) throw new Error("Model files missing. Run: m3 local download");
  const binary = await ensureLlamaBinary(opts.onLog);
  state.llamaServerPath = binary;
  saveLocalState(state);
  await startLlamaServer(state, opts.onLog);
}

export function stopLocalServer(): boolean {
  return stopLlamaServer();
}

export { loadLocalState } from "./state.js";
export { formatPresetList, resolveLocalModelInput, MODEL_PRESETS } from "./model-spec.js";

export async function getLocalStatus(): Promise<LocalStatus> {
  const state = loadLocalState();
  if (!state) {
    return {
      state: null,
      modelReady: false,
      binaryReady: false,
      serverRunning: false,
      healthOk: false,
    };
  }
  const modelReady = modelFilesReady(state);
  const binaryReady = fs.existsSync(state.llamaServerPath);
  const healthOk = await checkServerHealth(state.serverPort);
  return {
    state,
    modelReady,
    binaryReady,
    serverRunning: healthOk,
    serverUrl: getServerBaseUrl(state.serverPort),
    healthOk,
  };
}

export function isLocalModelRef(modelRef: string): boolean {
  return modelRef.startsWith("local/");
}
