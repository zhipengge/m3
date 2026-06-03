import { describe, expect, it } from "vitest";
import { pickLlamaReleaseAsset, platformAssetToken } from "./llama-binary.js";

const MOCK_ASSETS = [
  { name: "llama-b9493-bin-macos-arm64.tar.gz", browser_download_url: "https://x/a1" },
  { name: "llama-b9493-bin-macos-x64.tar.gz", browser_download_url: "https://x/a2" },
  { name: "llama-b9493-bin-ubuntu-arm64.tar.gz", browser_download_url: "https://x/a3" },
  { name: "llama-b9493-bin-ubuntu-vulkan-arm64.tar.gz", browser_download_url: "https://x/a4" },
  { name: "llama-b9493-bin-win-cuda-12.4-x64.zip", browser_download_url: "https://x/a5" },
  { name: "llama-b9493-bin-win-cpu-x64.zip", browser_download_url: "https://x/a6" },
];

describe("pickLlamaReleaseAsset", () => {
  it("selects macos arm64 CPU tarball on darwin arm64", () => {
    if (process.platform !== "darwin" || process.arch !== "arm64") return;
    const picked = pickLlamaReleaseAsset(MOCK_ASSETS);
    expect(picked?.name).toBe("llama-b9493-bin-macos-arm64.tar.gz");
  });

  it("prefers plain ubuntu-arm64 over vulkan build on linux arm64", () => {
    if (process.platform !== "linux" || process.arch !== "arm64") return;
    const picked = pickLlamaReleaseAsset(MOCK_ASSETS);
    expect(picked?.name).toBe("llama-b9493-bin-ubuntu-arm64.tar.gz");
  });

  it("excludes cuda builds on win32 x64", () => {
    if (process.platform !== "win32" || process.arch !== "x64") return;
    const picked = pickLlamaReleaseAsset(MOCK_ASSETS);
    expect(picked?.name).toBe("llama-b9493-bin-win-cpu-x64.zip");
  });

  it("platformAssetToken matches new llama.cpp naming", () => {
    const token = platformAssetToken();
    expect(token).toMatch(/^bin-/);
    expect(`llama-b9493-${token}.tar.gz`).toContain(token);
  });
});
