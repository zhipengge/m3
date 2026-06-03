import { describe, expect, it } from "vitest";
import { buildDownloadUrl } from "./mirror.js";

describe("buildDownloadUrl", () => {
  it("builds huggingface resolve URL", () => {
    const url = buildDownloadUrl("huggingface", "Qwen/Qwen3-VL-4B-Instruct-GGUF", "Qwen3VL-4B-Instruct-Q4_K_M.gguf");
    expect(url).toContain("huggingface.co");
    expect(url).toContain("Qwen/Qwen3-VL-4B-Instruct-GGUF");
    expect(url).toContain("Qwen3VL-4B-Instruct-Q4_K_M.gguf");
  });

  it("builds modelscope resolve URL", () => {
    const url = buildDownloadUrl("modelscope", "Qwen/Qwen3-VL-4B-Instruct-GGUF", "mmproj-Qwen3VL-4B-Instruct-F16.gguf");
    expect(url).toContain("modelscope.cn");
    expect(url).toContain("mmproj-Qwen3VL-4B-Instruct-F16.gguf");
  });
});
