import type { QuantLevel } from "./constants.js";

export type ModelMirror = "huggingface" | "modelscope";

export type LocalState = {
  version: 1 | 2;
  mirror: ModelMirror;
  quant: QuantLevel;
  /** m3 model slug (local/<modelSlug>). */
  modelSlug: string;
  /** HF / ModelScope repo id. */
  repo: string;
  displayName: string;
  vision: boolean;
  modelDir: string;
  llmFile: string;
  /** Empty when text-only model. */
  mmprojFile: string;
  serverPort: number;
  llamaServerPath: string;
  ctxSize?: number;
  configuredAt?: string;
};

export type LocalSetupOptions = {
  /** Preset id (qwen3-vl-4b-instruct) or full repo (Qwen/…-GGUF). */
  model?: string;
  mirror?: "auto" | ModelMirror;
  quant?: QuantLevel;
  port?: number;
  skipDownload?: boolean;
  skipBinary?: boolean;
  skipConfig?: boolean;
  skipStart?: boolean;
  configPath?: string;
  onLog?: (line: string) => void;
  connections?: number;
  concurrent?: number;
  noAria2?: boolean;
  aria2Path?: string;
  ctxSize?: number;
};

export type LocalStatus = {
  state: LocalState | null;
  modelReady: boolean;
  binaryReady: boolean;
  serverRunning: boolean;
  serverUrl?: string;
  healthOk: boolean;
};
