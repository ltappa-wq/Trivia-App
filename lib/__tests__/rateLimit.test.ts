import { describe, expect, it } from "vitest";
import { RateLimiter } from "../rateLimit";

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
