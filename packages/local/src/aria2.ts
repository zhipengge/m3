import { execSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type DownloadJob = {
  url: string;
  destDir: string;
  filename: string;
};

export type Aria2DownloadOptions = {
  /** Path to aria2c binary (default: search PATH). */
  aria2Path?: string;
  /** Connections per file (-x / -s). */
  connections?: number;
  /** Max concurrent downloads (-j). */
  concurrent?: number;
  /** Force Node fetch even if aria2 is installed. */
  noAria2?: boolean;
  onLog?: (line: string) => void;
};

const MIN_COMPLETE_BYTES = 1024 * 1024;

export function findAria2(explicitPath?: string): string | null {
  if (explicitPath) {
    return fs.existsSync(explicitPath) ? explicitPath : null;
  }
  try {
    const cmd = process.platform === "win32" ? "where aria2c" : "command -v aria2c";
    const out = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const first = out.split(/\r?\n/)[0]?.trim();
    return first || null;
  } catch {
    return null;
  }
}

export function isJobComplete(job: DownloadJob): boolean {
  const dest = path.join(job.destDir, job.filename);
  if (!fs.existsSync(dest)) return false;
  return fs.statSync(dest).size >= MIN_COMPLETE_BYTES;
}

export function partitionJobs(jobs: DownloadJob[]): {
  pending: DownloadJob[];
  skipped: DownloadJob[];
} {
  const pending: DownloadJob[] = [];
  const skipped: DownloadJob[] = [];
  for (const job of jobs) {
    if (isJobComplete(job)) skipped.push(job);
    else pending.push(job);
  }
  return { pending, skipped };
}

/** Build aria2c argv for multi-file concurrent download with resume (-c). */
export function buildAria2Args(binary: string, jobs: DownloadJob[], opts: Aria2DownloadOptions): string[] {
  const connections = opts.connections ?? 16;
  const concurrent = Math.max(1, Math.min(opts.concurrent ?? jobs.length, jobs.length));

  const args = [
    "-c",
    "--auto-file-renaming=false",
    "--allow-overwrite=true",
    "--continue=true",
    "--max-tries=5",
    "--retry-wait=3",
    `--max-connection-per-server=${connections}`,
    `-s${connections}`,
    `-j${concurrent}`,
    "--summary-interval=1",
    "--console-log-level=notice",
  ];

  for (const job of jobs) {
    fs.mkdirSync(job.destDir, { recursive: true });
    args.push(`--dir=${job.destDir}`, `--out=${job.filename}`, job.url);
  }

  void binary;
  return args;
}

export async function downloadJobsWithAria2(
  jobs: DownloadJob[],
  opts: Aria2DownloadOptions = {},
): Promise<void> {
  if (jobs.length === 0) return;

  const binary = findAria2(opts.aria2Path);
  if (!binary) {
    throw new Error("aria2c not found");
  }

  const args = buildAria2Args(binary, jobs, opts);
  opts.onLog?.(`  aria2c: ${jobs.length} file(s), -j${Math.min(opts.concurrent ?? jobs.length, jobs.length)}, resume enabled`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "inherit", "inherit"],
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`aria2c exited with code ${code}`));
    });
  });

  for (const job of jobs) {
    if (!isJobComplete(job)) {
      throw new Error(`Download incomplete: ${job.filename}`);
    }
  }
}

export function shouldUseAria2(opts: Aria2DownloadOptions): boolean {
  if (opts.noAria2) return false;
  return findAria2(opts.aria2Path) !== null;
}
