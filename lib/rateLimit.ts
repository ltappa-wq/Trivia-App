// Sliding-window rate limiter (KTD7, KTD10).
// Prefer the shared Postgres check (migration 0009) so multi-instance Vercel
// deployments share one budget for createGame (xAI cost) and joinGame (code
// enumeration). The in-memory RateLimiter remains for unit tests and as a
// same-instance first line when the shared RPC is unavailable.

import type { SupabaseClient } from "@supabase/supabase-js";

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

/**
 * Shared rate limit via `check_rate_limit` RPC. Returns false when throttled.
 * On RPC failure, falls back to a process-local limiter so a transient DB blip
 * does not open an unbounded window (local still caps one instance).
 */
const localFallback = new Map<string, RateLimiter>();

export async function checkSharedRateLimit(
  supabase: SupabaseClient,
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("check_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_window_ms: windowMs,
  });

  if (!error && typeof data === "boolean") {
    return data;
  }

  if (error) {
    console.error(`[rateLimit] shared check failed for ${key}: ${error.message}`);
  }

  const fallbackKey = `${limit}:${windowMs}`;
  let local = localFallback.get(fallbackKey);
  if (!local) {
    local = new RateLimiter(limit, windowMs);
    localFallback.set(fallbackKey, local);
  }
  return local.check(key);
}
