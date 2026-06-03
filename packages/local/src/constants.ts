import { expandHome } from "@m3/config";

export const MODEL_ID = "Qwen3-VL-4B-Instruct";
export const MODEL_SLUG = "qwen3-vl-4b-instruct";

export const HF_REPO = "Qwen/Qwen3-VL-4B-Instruct-GGUF";
export const MS_REPO = "Qwen/Qwen3-VL-4B-Instruct-GGUF";

export const QUANT_FILES = {
  Q4_K_M: {
    llm: "Qwen3VL-4B-Instruct-Q4_K_M.gguf",
    mmproj: "mmproj-Qwen3VL-4B-Instruct-F16.gguf",
  },
  Q8_0: {
    llm: "Qwen3VL-4B-Instruct-Q8_0.gguf",
    mmproj: "mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf",
  },
} as const;

export type QuantLevel = keyof typeof QUANT_FILES;

export const DEFAULT_QUANT: QuantLevel = "Q4_K_M";
export const DEFAULT_SERVER_PORT = 8080;
/** llama-server -c / --ctx-size (Qwen3-VL supports 32k+; old default 4096 overflows easily). */
export const DEFAULT_LLAMA_CTX_SIZE = 32_768;
export const LOCAL_PROVIDER_ID = "local";
export const LOCAL_MODEL_REF = `${LOCAL_PROVIDER_ID}/${MODEL_SLUG}`;

export const M3_HOME = expandHome("~/.m3");
export const MODEL_DIR = `${M3_HOME}/models/${MODEL_SLUG}`;
export const RUNTIME_DIR = `${M3_HOME}/runtime/llama.cpp`;
export const STATE_PATH = `${M3_HOME}/local.json`;
export const SERVER_PID_PATH = `${M3_HOME}/llama-server.pid`;
