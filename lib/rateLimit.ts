// Lightweight in-memory sliding-window rate limiter (KTD7, KTD10).
// Best-effort per serverless instance — it caps abuse (createGame cost-DoS on
// the xAI budget; join-code enumeration) without external state. A determined
// attacker across many cold instances is out of scope for the ≤10-player target;
// a shared store (e.g. Supabase/Redis) is the upgrade path if needed.

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Record an attempt for `key` and report whether it is allowed. Returns false
   * once `limit` attempts have occurred within the trailing `windowMs`.
   */
  check(key: string, now: number = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}
