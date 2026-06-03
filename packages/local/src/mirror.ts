import type { ModelMirror } from "./types.js";

const HF_PROBE = "https://huggingface.co";
const MS_PROBE = "https://www.modelscope.cn";

export async function detectModelMirror(timeoutMs = 5000): Promise<ModelMirror> {
  if (await probeUrl(HF_PROBE, timeoutMs)) return "huggingface";
  if (await probeUrl(MS_PROBE, timeoutMs)) return "modelscope";
  // Default to ModelScope when both fail (common in CN); HF as second try in download.
  return "modelscope";
}

export function resolveMirrorChoice(choice: "auto" | ModelMirror | undefined): Promise<ModelMirror> {
  if (choice === "huggingface" || choice === "modelscope") {
    return Promise.resolve(choice);
  }
  return detectModelMirror();
}

async function probeUrl(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
    });
    return res.ok || res.status === 301 || res.status === 302;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function buildDownloadUrl(mirror: ModelMirror, repo: string, filename: string): string {
  if (mirror === "huggingface") {
    return `https://huggingface.co/${repo}/resolve/main/${encodeURIComponent(filename)}`;
  }
  return `https://www.modelscope.cn/models/${repo}/resolve/master/${encodeURIComponent(filename)}`;
}
