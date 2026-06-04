/** Run a promise with a timeout; resolves undefined on timeout (does not throw). */
export async function withShutdownTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          console.error(`[m3] ${label} timed out after ${ms}ms — continuing shutdown`);
          resolve(undefined);
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
