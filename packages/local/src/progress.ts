const BAR_WIDTH = 32;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
const MIN_INTERVAL_MS = 80;

export function renderProgressBar(ratio: number, width = BAR_WIDTH): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  const filled = Math.round(clamped * width);
  const empty = width - filled;
  return `[${"=".repeat(filled)}${"-".repeat(empty)}]`;
}

export type ProgressReporter = {
  update: (received: number, total: number) => void;
  finish: (message?: string) => void;
};

export function createDownloadProgress(label: string): ProgressReporter {
  const stream = process.stderr;
  const isTTY = stream.isTTY === true;
  let lastDraw = 0;
  let lastLoggedPct = -1;

  const formatLine = (received: number, total: number): string => {
    if (total > 0) {
      const ratio = received / total;
      const pct = (ratio * 100).toFixed(1);
      const bar = renderProgressBar(ratio);
      return `${label} ${bar} ${pct}%  ${formatBytes(received)} / ${formatBytes(total)}`;
    }
    return `${label} ${renderProgressBar(0)}  ${formatBytes(received)} downloaded…`;
  };

  const draw = (line: string, done = false): void => {
    if (!isTTY) {
      if (done) {
        stream.write(`${line}\n`);
      }
      return;
    }
    stream.write(`\x1b[2K\r${line}`);
    if (done) stream.write("\n");
  };

  return {
    update(received: number, total: number) {
      const now = Date.now();
      if (now - lastDraw < MIN_INTERVAL_MS && total > 0 && received < total) return;
      lastDraw = now;

      const line = formatLine(received, total);

      if (!isTTY) {
        if (total > 0) {
          const pct = Math.floor((received / total) * 100);
          if (pct < lastLoggedPct + 5 && received < total) return;
          lastLoggedPct = pct;
        }
        stream.write(`${line}\n`);
        return;
      }

      draw(line);
    },

    finish(message?: string) {
      const line = message ?? `${label} done`;
      draw(line, true);
    },
  };
}
