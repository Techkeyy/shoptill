/** Tiny in-memory sliding-window limiter (single process). */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number, private maxKeys = 10_000) {}

  private fresh(key: string, nowMs: number): number[] {
    const h = (this.hits.get(key) ?? []).filter((t) => nowMs - t < this.windowMs);
    if (h.length) this.hits.set(key, h); else this.hits.delete(key);
    return h;
  }

  /** True when `key` has already used up its budget in the window (does not record). */
  blocked(key: string, nowMs: number): boolean { return this.fresh(key, nowMs).length >= this.max; }

  /** Record one event. Returns false when it exceeds the budget (the event is still counted). */
  hit(key: string, nowMs: number): boolean {
    const h = this.fresh(key, nowMs);
    if (!this.hits.has(key) && this.hits.size >= this.maxKeys) this.hits.delete(this.hits.keys().next().value!);
    h.push(nowMs);
    this.hits.set(key, h);
    return h.length <= this.max;
  }
}
