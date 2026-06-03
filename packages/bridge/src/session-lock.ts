/** Serialize inbound handling per sessionKey to avoid overlapping agent runs. */
export class SessionLock {
  private tails = new Map<string, Promise<void>>();

  async run<T>(sessionKey: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(sessionKey) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chain = prev.then(() => gate);
    this.tails.set(sessionKey, chain);
    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(sessionKey) === chain) {
        this.tails.delete(sessionKey);
      }
    }
  }
}
