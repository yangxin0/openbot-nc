const KEY_LIMIT = 10_000;

export class SlidingWindowLimit {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  readonly #hits = new Map<string, number[]>();

  constructor(limit: number, windowMs: number, now: () => number = Date.now) {
    this.#limit = limit;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  take(key: string): boolean {
    const now = this.#now();
    if (this.#hits.size >= KEY_LIMIT) this.#forgetOld(now);
    const recent = (this.#hits.get(key) ?? []).filter((time) => now - time < this.#windowMs);
    if (recent.length >= this.#limit) {
      this.#hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.#hits.set(key, recent);
    return true;
  }

  #forgetOld(now: number): void {
    for (const [key, times] of this.#hits) {
      if (times.every((time) => now - time >= this.#windowMs)) this.#hits.delete(key);
    }
    if (this.#hits.size >= KEY_LIMIT) this.#hits.clear();
  }
}
