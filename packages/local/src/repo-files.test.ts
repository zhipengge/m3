import { describe, expect, it } from "vitest";
import { pickGgufFiles } from "./repo-files.js";
import { resolveLocalModelInput, findPreset, slugFromRepo } from "./model-spec.js";

describe("resolveLocalModelInput", () => {
  it("resolves default preset", () => {
    const m = resolveLocalModelInput();
    expect(m.id).toBe("qwen3-vl-4b-instruct");
    expect(m.repo).toContain("Qwen3-VL-4B-Instruct");
  });

  it("resolves preset by id", () => {
    const m = resolveLocalModelInput("qwen2.5-7b-instruct");
    expect(m.vision).toBe(false);
    expect(m.repo).toContain("Qwen2.5-7B");
  });

  it("resolves custom repo path", () => {
    const m = resolveLocalModelInput("Qwen/Qwen3-VL-8B-Instruct-GGUF");
    expect(m.repo).toBe("Qwen/Qwen3-VL-8B-Instruct-GGUF");
    expect(m.vision).toBe(true);
  });
});

describe("pickGgufFiles", () => {
  const qwen3vlFiles = [
    "Qwen3VL-4B-Instruct-Q4_K_M.gguf",
    "Qwen3VL-4B-Instruct-Q8_0.gguf",
    "mmproj-Qwen3VL-4B-Instruct-F16.gguf",
  ];

  it("picks llm and mmproj for vision model", () => {
    const picked = pickGgufFiles(qwen3vlFiles, "Q4_K_M", true);
    expect(picked.llm).toBe("Qwen3VL-4B-Instruct-Q4_K_M.gguf");
    expect(picked.mmproj).toContain("mmproj");
  });

  it("picks llm only for text model listing", () => {
    const picked = pickGgufFiles(
      ["Meta-Llama-3.2-3B-Instruct-Q4_K_M.gguf", "Meta-Llama-3.2-3B-Instruct-Q8_0.gguf"],
      "Q4_K_M",
      false,
    );
    expect(picked.llm).toContain("Q4_K_M");
    expect(picked.mmproj).toBeUndefined();
  });
});

describe("slugFromRepo", () => {
  it("slugifies repo name", () => {
    expect(slugFromRepo("Qwen/Qwen3-VL-4B-Instruct-GGUF")).toBe("qwen3-vl-4b-instruct");
  });
});
