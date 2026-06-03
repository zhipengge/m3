import fs from "node:fs";
import path from "node:path";
import { expandHome } from "@m3/config";
import { STATE_PATH } from "./constants.js";
import { DEFAULT_MODEL_ID } from "./model-spec.js";
import type { LocalState } from "./types.js";

function migrateState(raw: Record<string, unknown>): LocalState | null {
  const version = raw.version;
  if (version !== 1 && version !== 2) return null;

  if (version === 1) {
    return {
      version: 2,
      mirror: raw.mirror as LocalState["mirror"],
      quant: raw.quant as LocalState["quant"],
      modelSlug: DEFAULT_MODEL_ID,
      repo: "Qwen/Qwen3-VL-4B-Instruct-GGUF",
      displayName: "Qwen3-VL-4B-Instruct",
      vision: true,
      modelDir: raw.modelDir as string,
      llmFile: raw.llmFile as string,
      mmprojFile: (raw.mmprojFile as string) ?? "",
      serverPort: raw.serverPort as number,
      llamaServerPath: raw.llamaServerPath as string,
      ctxSize: raw.ctxSize as number | undefined,
      configuredAt: raw.configuredAt as string | undefined,
    };
  }

  return raw as unknown as LocalState;
}

export function loadLocalState(): LocalState | null {
  const filePath = expandHome(STATE_PATH);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const state = migrateState(raw);
    if (!state) return null;
    return state;
  } catch {
    return null;
  }
}

export function saveLocalState(state: LocalState): void {
  const filePath = expandHome(STATE_PATH);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ ...state, version: 2 }, null, 2));
}
