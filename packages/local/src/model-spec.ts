import type { QuantLevel } from "./constants.js";
import { QUANT_FILES } from "./constants.js";

export type ModelPreset = {
  /** CLI id and m3 model slug (local/<id>). */
  id: string;
  displayName: string;
  /** Hugging Face / ModelScope repo id (Org/Name-GGUF). */
  repo: string;
  vision: boolean;
  defaultCtxSize?: number;
  /** Fixed GGUF filenames per quant; omit to auto-discover from repo listing. */
  files?: Partial<Record<QuantLevel, { llm: string; mmproj?: string }>>;
};

export const DEFAULT_MODEL_ID = "qwen3-vl-4b-instruct";

export const MODEL_PRESETS: ModelPreset[] = [
  {
    id: DEFAULT_MODEL_ID,
    displayName: "Qwen3-VL-4B-Instruct",
    repo: "Qwen/Qwen3-VL-4B-Instruct-GGUF",
    vision: true,
    defaultCtxSize: 32_768,
    files: { Q4_K_M: QUANT_FILES.Q4_K_M, Q8_0: QUANT_FILES.Q8_0 },
  },
  {
    id: "qwen3-vl-8b-instruct",
    displayName: "Qwen3-VL-8B-Instruct",
    repo: "Qwen/Qwen3-VL-8B-Instruct-GGUF",
    vision: true,
    defaultCtxSize: 32_768,
  },
  {
    id: "qwen2.5-vl-7b-instruct",
    displayName: "Qwen2.5-VL-7B-Instruct",
    repo: "Qwen/Qwen2.5-VL-7B-Instruct-GGUF",
    vision: true,
    defaultCtxSize: 32_768,
  },
  {
    id: "qwen2.5-7b-instruct",
    displayName: "Qwen2.5-7B-Instruct",
    repo: "Qwen/Qwen2.5-7B-Instruct-GGUF",
    vision: false,
    defaultCtxSize: 32_768,
  },
  {
    id: "llama-3.2-3b-instruct",
    displayName: "Llama 3.2 3B Instruct",
    repo: "bartowski/Llama-3.2-3B-Instruct-GGUF",
    vision: false,
    defaultCtxSize: 8192,
  },
];

export type ResolvedLocalModel = {
  id: string;
  displayName: string;
  repo: string;
  vision: boolean;
  defaultCtxSize: number;
  files?: ModelPreset["files"];
};

export function slugFromRepo(repo: string): string {
  const base = repo.split("/").pop() ?? repo;
  return base
    .replace(/-GGUF$/i, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function findPreset(input: string): ModelPreset | undefined {
  const key = input.trim().toLowerCase();
  return MODEL_PRESETS.find(
    (p) => p.id.toLowerCase() === key || p.repo.toLowerCase() === key.toLowerCase(),
  );
}

/** Resolve preset id, repo path (Org/Name), or repo path with -GGUF suffix. */
export function resolveLocalModelInput(input?: string): ResolvedLocalModel {
  const raw = (input ?? DEFAULT_MODEL_ID).trim();
  if (!raw) return resolveLocalModelInput(DEFAULT_MODEL_ID);

  const preset = findPreset(raw);
  if (preset) {
    return {
      id: preset.id,
      displayName: preset.displayName,
      repo: preset.repo,
      vision: preset.vision,
      defaultCtxSize: preset.defaultCtxSize ?? 32_768,
      files: preset.files,
    };
  }

  const repo = raw.includes("/") ? raw : `${raw}/${raw}-GGUF`;
  const id = slugFromRepo(repo);

  return {
    id,
    displayName: repo,
    repo: repo.endsWith("-GGUF") || repo.endsWith("-gguf") ? repo : `${repo}-GGUF`,
    vision: /vl|vision|multimodal|mmproj/i.test(repo),
    defaultCtxSize: 32_768,
  };
}

export function modelDirForSlug(slug: string): string {
  return `~/.m3/models/${slug}`;
}

export function localModelRef(slug: string): string {
  return `local/${slug}`;
}

export function formatPresetList(): string {
  const lines = ["Available local model presets (--model <id> or --model <Org/Repo-GGUF>):", ""];
  for (const p of MODEL_PRESETS) {
    lines.push(`  ${p.id}`);
    lines.push(`    ${p.displayName} · ${p.repo}${p.vision ? " · vision" : ""}`);
  }
  lines.push("");
  lines.push(`Default: ${DEFAULT_MODEL_ID}`);
  lines.push("Custom: m3 local --model Qwen/Qwen3-VL-8B-Instruct-GGUF");
  return lines.join("\n");
}
