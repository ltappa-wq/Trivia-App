import { describe, expect, it, vi } from "vitest";
import { RateLimiter, checkSharedRateLimit } from "../rateLimit";

describe("RateLimiter (KTD7/KTD10 abuse guard)", () => {
  it("allows up to the limit then throttles within the window", () => {
    const rl = new RateLimiter(3, 1000);
    const t0 = 10_000;
    expect(rl.check("ip", t0)).toBe(true);
    expect(rl.check("ip", t0 + 1)).toBe(true);
    expect(rl.check("ip", t0 + 2)).toBe(true);
    expect(rl.check("ip", t0 + 3)).toBe(false); // 4th within window blocked
  });

  it("frees capacity once earlier hits fall outside the window", () => {
    const rl = new RateLimiter(2, 1000);
    const t0 = 10_000;
    expect(rl.check("ip", t0)).toBe(true);
    expect(rl.check("ip", t0 + 500)).toBe(true);
    expect(rl.check("ip", t0 + 600)).toBe(false);
    // First hit (t0) is now > 1000ms old, so one slot frees up.
    expect(rl.check("ip", t0 + 1100)).toBe(true);
  });

  it("tracks keys independently (one IP does not throttle another)", () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.check("a", 0)).toBe(true);
    expect(rl.check("b", 0)).toBe(true);
    expect(rl.check("a", 1)).toBe(false);
  });
});

describe("checkSharedRateLimit", () => {
  it("returns the RPC boolean when the shared check succeeds", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const ok = await checkSharedRateLimit({ rpc } as never, "join:1.2.3.4", 5, 60_000);
    expect(ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith("check_rate_limit", {
      p_key: "join:1.2.3.4",
      p_limit: 5,
      p_window_ms: 60_000,
    });
  });

  it("falls back to process-local limiter when RPC errors", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: "unavailable" } });
    const client = { rpc } as never;
    // Unique key so parallel tests don't share the module-level fallback map.
    const key = `fallback-${Math.random()}`;
    expect(await checkSharedRateLimit(client, key, 1, 60_000)).toBe(true);
    expect(await checkSharedRateLimit(client, key, 1, 60_000)).toBe(false);
  });
});
