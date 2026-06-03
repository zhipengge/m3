import { describe, expect, it } from "vitest";
import { buildAria2Args, partitionJobs } from "./aria2.js";
import type { DownloadJob } from "./aria2.js";

describe("buildAria2Args", () => {
  it("includes resume and concurrent flags", () => {
    const jobs: DownloadJob[] = [
      { url: "https://example.com/a.gguf", destDir: "/tmp/m", filename: "a.gguf" },
      { url: "https://example.com/b.gguf", destDir: "/tmp/m", filename: "b.gguf" },
    ];
    const args = buildAria2Args("/usr/bin/aria2c", jobs, { connections: 8, concurrent: 2 });
    expect(args).toContain("-c");
    expect(args).toContain("-j2");
    expect(args).toContain("--max-connection-per-server=8");
    expect(args.some((a) => a.startsWith("--dir="))).toBe(true);
    expect(args).toContain("https://example.com/a.gguf");
    expect(args).toContain("https://example.com/b.gguf");
  });
});

describe("partitionJobs", () => {
  it("treats missing files as pending", () => {
    const { pending, skipped } = partitionJobs([
      { url: "u", destDir: "/nonexistent-dir-xyz", filename: "missing.gguf" },
    ]);
    expect(pending).toHaveLength(1);
    expect(skipped).toHaveLength(0);
  });
});
