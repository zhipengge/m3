import { Command } from "commander";
import {
  downloadLocalModelOnly,
  formatPresetList,
  getLocalStatus,
  runLocalSetup,
  startLocalServer,
  stopLocalServer,
  type LocalSetupOptions,
  type QuantLevel,
} from "@m3/local";

function parseDownloadFlags(opts: {
  connections?: string;
  concurrent?: string;
  noAria2?: boolean;
  aria2Path?: string;
  ctxSize?: string;
}): Pick<LocalSetupOptions, "connections" | "concurrent" | "noAria2" | "aria2Path" | "ctxSize"> {
  return {
    connections: opts.connections ? Number(opts.connections) : undefined,
    concurrent: opts.concurrent ? Number(opts.concurrent) : undefined,
    noAria2: opts.noAria2,
    aria2Path: opts.aria2Path,
    ctxSize: opts.ctxSize ? Number(opts.ctxSize) : undefined,
  };
}

const downloadOptions = [
  ["--connections <n>", "aria2c: connections per file (-x/-s)", "16"],
  ["--concurrent <n>", "aria2c: parallel downloads (-j)", "2"],
  ["--ctx-size <n>", "llama-server context window", "32768"],
  ["--no-aria2", "Use built-in downloader only (no aria2c)"],
  ["--aria2-path <path>", "Path to aria2c binary"],
] as const;

function addModelOption(cmd: Command): void {
  cmd.option(
    "--model <id|repo>",
    "Preset id (default qwen3-vl-4b-instruct) or Org/Repo-GGUF from HF/ModelScope",
  );
}

export function registerLocalCommand(program: Command): void {
  const local = program
    .command("local")
    .description(
      "Offline GGUF models via llama.cpp: download from HuggingFace/ModelScope, configure m3 (default: qwen3-vl-4b-instruct)",
    )
    .option("--mirror <source>", "auto | huggingface | modelscope", "auto")
    .option("--quant <level>", "Q4_K_M | Q8_0", "Q4_K_M")
    .option("--port <port>", "llama-server OpenAI port", "8080")
    .option("--skip-download", "Skip model download")
    .option("--no-start", "Do not start llama-server after setup")
    .option("--config <path>", "m3.json path");

  addModelOption(local);

  for (const [flags, desc, defaultVal] of downloadOptions) {
    if (defaultVal) local.option(flags, desc, defaultVal);
    else local.option(flags, desc);
  }

  local.action(
    async (opts: {
      mirror: string;
      quant: string;
      port: string;
      model?: string;
      skipDownload?: boolean;
      noStart?: boolean;
      config?: string;
      connections?: string;
      concurrent?: string;
      noAria2?: boolean;
      aria2Path?: string;
      ctxSize?: string;
    }) => {
      const mirror = opts.mirror as "auto" | "huggingface" | "modelscope";
      if (!["auto", "huggingface", "modelscope"].includes(mirror)) {
        console.error("Invalid --mirror (use auto, huggingface, or modelscope)");
        process.exit(1);
      }
      const quant = opts.quant as QuantLevel;
      if (quant !== "Q4_K_M" && quant !== "Q8_0") {
        console.error("Invalid --quant (use Q4_K_M or Q8_0)");
        process.exit(1);
      }
      try {
        await runLocalSetup({
          model: opts.model,
          mirror,
          quant,
          port: Number(opts.port),
          skipDownload: opts.skipDownload,
          skipStart: opts.noStart,
          configPath: opts.config,
          ...parseDownloadFlags(opts),
        });
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    },
  );

  local
    .command("list")
    .description("List built-in local model presets")
    .action(() => {
      console.log(formatPresetList());
    });

  const dl = local
    .command("download")
    .description("Download GGUF weights only (no llama binary / config)")
    .option("--mirror <source>", "auto | huggingface | modelscope", "auto")
    .option("--quant <level>", "Q4_K_M | Q8_0", "Q4_K_M")
    .option("--config <path>", "m3.json path");

  addModelOption(dl);

  for (const [flags, desc, defaultVal] of downloadOptions) {
    if (defaultVal) dl.option(flags, desc, defaultVal);
    else dl.option(flags, desc);
  }

  dl.action(
    async (opts: {
      mirror: string;
      quant: string;
      model?: string;
      config?: string;
      connections?: string;
      concurrent?: string;
      noAria2?: boolean;
      aria2Path?: string;
    }) => {
      try {
        await downloadLocalModelOnly({
          model: opts.model,
          mirror: opts.mirror as "auto" | "huggingface" | "modelscope",
          quant: opts.quant as QuantLevel,
          configPath: opts.config,
          ...parseDownloadFlags(opts),
        });
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    },
  );

  local
    .command("start")
    .description("Start llama-server for the local model")
    .action(async () => {
      try {
        await startLocalServer();
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });

  local
    .command("stop")
    .description("Stop llama-server")
    .action(() => {
      const stopped = stopLocalServer();
      console.log(stopped ? "Stopped llama-server." : "llama-server was not running.");
    });

  local
    .command("status")
    .description("Local model download and llama-server status")
    .action(async () => {
      const s = await getLocalStatus();
      console.log("m3 local status\n");
      if (!s.state) {
        console.log("Not configured. Run: m3 local");
        return;
      }
      console.log(`Model: ${s.state.displayName} (${s.state.modelSlug})`);
      console.log(`Repo: ${s.state.repo}`);
      console.log(`Mirror: ${s.state.mirror}`);
      console.log(`Quant: ${s.state.quant}`);
      console.log(`Model dir: ${s.state.modelDir}`);
      console.log(`LLM: ${s.state.llmFile} — ${s.modelReady ? "ready" : "missing"}`);
      if (s.state.vision) {
        console.log(`mmproj: ${s.state.mmprojFile || "(none)"} — ${s.modelReady ? "ready" : "missing"}`);
      }
      console.log(`llama-server binary: ${s.binaryReady ? "ready" : "missing"}`);
      console.log(`Server: ${s.healthOk ? `running ${s.serverUrl}` : "not running"}`);
      if (s.state.ctxSize) console.log(`ctx-size: ${s.state.ctxSize}`);
      if (!s.healthOk) console.log("  Start with: m3 local start");
    });

  local.addHelpText(
    "after",
    `
Examples:
  m3 local                              Default: qwen3-vl-4b-instruct
  m3 local --model qwen3-vl-8b-instruct Another preset
  m3 local --model Qwen/Qwen2.5-7B-Instruct-GGUF   Custom repo (auto-discover GGUF)
  m3 local list                         Show presets
  m3 local --mirror modelscope          Force ModelScope download
  m3 local download                     Weights only

Download uses aria2c when installed (resume + parallel):
  brew install aria2                    macOS
  apt install aria2                     Debian/Ubuntu

  m3 local --concurrent 2 --connections 16
  m3 local --no-aria2                   Built-in downloader with HTTP Range resume

Disk usage depends on model/quant. llama-server on :8080 by default.
`,
  );
}
