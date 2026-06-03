import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { RUNTIME_DIR } from "./constants.js";
import { downloadUrl } from "./download.js";

type ReleaseAsset = { name: string; browser_download_url: string };

/** Substring matched inside release asset names, e.g. `llama-b9493-bin-macos-arm64.tar.gz`. */
export function platformAssetToken(): string {
  const { platform, arch } = process;
  if (platform === "darwin" && arch === "arm64") return "bin-macos-arm64";
  if (platform === "darwin" && arch === "x64") return "bin-macos-x64";
  if (platform === "linux" && arch === "arm64") return "bin-ubuntu-arm64";
  if (platform === "linux" && arch === "x64") return "bin-ubuntu-x64";
  if (platform === "win32" && arch === "arm64") return "bin-win-cpu-arm64";
  if (platform === "win32" && arch === "x64") return "bin-win-cpu-x64";
  throw new Error(`Unsupported platform for llama.cpp: ${platform} ${arch}`);
}

const GPU_BUILD_MARKERS = ["cuda", "vulkan", "rocm", "hip", "openvino", "opencl", "adreno", "sycl"];

/** Pick the generic CPU binary (shortest matching name, avoids cuda/vulkan variants). */
export function pickLlamaReleaseAsset(assets: ReleaseAsset[]): ReleaseAsset | undefined {
  const token = platformAssetToken();
  const candidates = assets.filter(
    (a) =>
      a.name.includes(token) &&
      /\.(tar\.xz|tar\.gz|zip)$/i.test(a.name) &&
      !GPU_BUILD_MARKERS.some((m) => a.name.toLowerCase().includes(m)),
  );
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => a.name.length - b.name.length);
  return candidates[0];
}

export function findLlamaServerBinary(rootDir: string): string | null {
  const names = process.platform === "win32" ? ["llama-server.exe", "llama-server"] : ["llama-server"];
  const queue = [rootDir];
  while (queue.length) {
    const dir = queue.shift()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        queue.push(full);
      } else if (names.includes(ent.name)) {
        return full;
      }
    }
  }
  return null;
}

async function fetchLatestLlamaAsset(): Promise<ReleaseAsset> {
  const token = platformAssetToken();
  const res = await fetch("https://api.github.com/repos/ggml-org/llama.cpp/releases/latest", {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "m3-local" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch llama.cpp release metadata (${res.status})`);
  }
  const data = (await res.json()) as { tag_name?: string; assets?: ReleaseAsset[] };
  const asset = pickLlamaReleaseAsset(data.assets ?? []);
  if (!asset) {
    const sample = (data.assets ?? [])
      .map((a) => a.name)
      .filter((n) => n.includes("bin-"))
      .slice(0, 8)
      .join(", ");
    throw new Error(
      `No llama.cpp CPU binary for *${token}* (release ${data.tag_name ?? "latest"}).` +
        (sample ? ` Available: ${sample}…` : " No assets listed."),
    );
  }
  return asset;
}

export async function ensureLlamaBinary(
  onLog?: (line: string) => void,
  downloadOpts?: import("./download.js").DownloadOptions,
): Promise<string> {
  const existing = findLlamaServerBinary(RUNTIME_DIR);
  if (existing) {
    onLog?.(`llama-server: ${existing}`);
    return existing;
  }

  onLog?.("Fetching latest llama.cpp release…");
  const asset = await fetchLatestLlamaAsset();
  onLog?.(`  asset: ${asset.name}`);

  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  const archivePath = path.join(RUNTIME_DIR, asset.name);

  if (!fs.existsSync(archivePath)) {
    onLog?.(`  downloading ${asset.name}…`);
    await downloadUrl(asset.browser_download_url, archivePath, {
      ...downloadOpts,
      onLog,
      concurrent: downloadOpts?.concurrent ?? 1,
    });
  }

  onLog?.("  extracting…");
  if (asset.name.endsWith(".tar.xz")) {
    execSync(`tar -xJf "${archivePath}" -C "${RUNTIME_DIR}"`, { stdio: "pipe" });
  } else if (asset.name.endsWith(".tar.gz")) {
    execSync(`tar -xzf "${archivePath}" -C "${RUNTIME_DIR}"`, { stdio: "pipe" });
  } else if (asset.name.endsWith(".zip")) {
    execSync(`unzip -o -q "${archivePath}" -d "${RUNTIME_DIR}"`, { stdio: "pipe" });
  } else {
    throw new Error(`Unsupported archive: ${asset.name}`);
  }

  const binary = findLlamaServerBinary(RUNTIME_DIR);
  if (!binary) {
    throw new Error("llama-server not found after extracting llama.cpp");
  }
  if (process.platform !== "win32") {
    fs.chmodSync(binary, 0o755);
  }
  onLog?.(`llama-server ready: ${binary}`);
  return binary;
}
