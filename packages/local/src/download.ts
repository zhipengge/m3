import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { ModelMirror } from "./types.js";
import { buildDownloadUrl } from "./mirror.js";
import {
  downloadJobsWithAria2,
  partitionJobs,
  shouldUseAria2,
  type Aria2DownloadOptions,
  type DownloadJob,
} from "./aria2.js";
import { createDownloadProgress, formatBytes } from "./progress.js";

export { formatBytes } from "./progress.js";

export type DownloadOptions = Aria2DownloadOptions;

export async function downloadModelFiles(
  mirror: ModelMirror,
  repo: string,
  filenames: string[],
  destDir: string,
  opts: DownloadOptions = {},
): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true });

  const jobs: DownloadJob[] = filenames.map((filename) => ({
    url: buildDownloadUrl(mirror, repo, filename),
    destDir,
    filename,
  }));

  const { pending, skipped } = partitionJobs(jobs);
  for (const job of skipped) {
    const dest = path.join(job.destDir, job.filename);
    opts.onLog?.(`  skip (exists): ${job.filename} (${formatBytes(fs.statSync(dest).size)})`);
  }

  if (pending.length === 0) return;

  for (const job of pending) {
    opts.onLog?.(`  download: ${job.filename}`);
    opts.onLog?.(`    from ${mirror}`);
  }

  if (shouldUseAria2(opts)) {
    try {
      await downloadJobsWithAria2(pending, opts);
      for (const job of pending) {
        const dest = path.join(job.destDir, job.filename);
        opts.onLog?.(`  done: ${job.filename} (${formatBytes(fs.statSync(dest).size)})`);
      }
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (opts.noAria2) throw err;
      opts.onLog?.(`  aria2 failed (${msg}), falling back to built-in downloader…`);
    }
  } else {
    opts.onLog?.(
      "  tip: install aria2c for resume + parallel downloads (e.g. brew install aria2)",
    );
  }

  await Promise.all(
    pending.map((job) =>
      downloadFileFetch(job.url, path.join(job.destDir, job.filename), job.filename),
    ),
  );
}

export async function downloadFile(
  mirror: ModelMirror,
  repo: string,
  filename: string,
  destDir: string,
  onLog?: (line: string) => void,
): Promise<string> {
  await downloadModelFiles(mirror, repo, [filename], destDir, { onLog });
  return path.join(destDir, filename);
}

export async function downloadUrl(
  url: string,
  destPath: string,
  opts: DownloadOptions = {},
): Promise<void> {
  const dir = path.dirname(destPath);
  const filename = path.basename(destPath);
  const job: DownloadJob = { url, destDir: dir, filename };

  const { pending } = partitionJobs([job]);
  if (pending.length === 0) {
    opts.onLog?.(`  skip (exists): ${filename} (${formatBytes(fs.statSync(destPath).size)})`);
    return;
  }

  opts.onLog?.(`  download: ${filename}`);

  if (shouldUseAria2(opts)) {
    try {
      await downloadJobsWithAria2(pending, opts);
      opts.onLog?.(`  done: ${filename} (${formatBytes(fs.statSync(destPath).size)})`);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      opts.onLog?.(`  aria2 failed (${msg}), falling back…`);
    }
  }

  await downloadFileFetch(url, destPath, filename);
}

async function downloadFileFetch(url: string, destPath: string, label: string): Promise<void> {
  const progress = createDownloadProgress(`  ${label}`);
  try {
    await fetchToFile(url, destPath, (received, total) => {
      progress.update(received, total);
    });
    progress.finish(`  done: ${label} (${formatBytes(fs.statSync(destPath).size)})`);
  } catch (err) {
    progress.finish(`  failed: ${label}`);
    throw err;
  }
}

export async function fetchToFile(
  url: string,
  destPath: string,
  onProgress?: (received: number, total: number) => void,
): Promise<void> {
  const tmp = `${destPath}.part`;
  let start = 0;
  if (fs.existsSync(tmp)) {
    start = fs.statSync(tmp).size;
  }

  const headers: Record<string, string> = {};
  if (start > 0) {
    headers.Range = `bytes=${start}-`;
  }

  let res = await fetch(url, { headers, redirect: "follow" });

  if (start > 0 && res.status === 416) {
    fs.renameSync(tmp, destPath);
    const size = fs.statSync(destPath).size;
    onProgress?.(size, size);
    return;
  }

  if (!res.ok || !res.body) {
    throw new Error(`Download failed (${res.status}): ${url}`);
  }

  if (start > 0 && res.status !== 206) {
    fs.unlinkSync(tmp);
    start = 0;
    const full = await fetch(url, { redirect: "follow" });
    if (!full.ok || !full.body) {
      throw new Error(`Download failed (${full.status}): ${url}`);
    }
    await writeResponseToFile(full, tmp, 0, onProgress);
    fs.renameSync(tmp, destPath);
    return;
  }

  await writeResponseToFile(res, tmp, start, onProgress);
  fs.renameSync(tmp, destPath);
}

async function writeResponseToFile(
  res: Response,
  tmp: string,
  start: number,
  onProgress?: (received: number, total: number) => void,
): Promise<void> {
  let total = Number(res.headers.get("content-length") ?? 0);
  const range = res.headers.get("content-range");
  if (range) {
    const m = /\/(\d+)$/.exec(range);
    if (m) total = Number(m[1]);
  } else if (start > 0) {
    total = start + total;
  }

  let received = start;
  const nodeStream = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);

  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(tmp, start > 0 ? { flags: "a" } : undefined);
    nodeStream.on("data", (chunk: Buffer) => {
      received += chunk.length;
      onProgress?.(received, total);
    });
    nodeStream.on("error", reject);
    out.on("error", reject);
    out.on("finish", resolve);
    nodeStream.pipe(out);
  });
}
