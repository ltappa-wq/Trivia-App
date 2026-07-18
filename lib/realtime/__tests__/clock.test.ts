import { describe, expect, it } from "vitest";
import { isGetReadyPhase, measureClockOffset, msUntilReveal, remainingMs } from "../clock";

describe("measureClockOffset (KTD9)", () => {
  it("computes offset as server time minus the round-trip midpoint", async () => {
    // Local clock ticks 1000 -> 1040 across the call; server says it's 6000 at
    // the midpoint (1020). Offset should be 6000 - 1020 = 4980.
    let t = 1000;
    const now = () => {
      const v = t;
      t += 40; // advance 40ms per read (t0=1000, t1=1040)
      return v;
    };
    const offset = await measureClockOffset(async () => 6000, now);
    expect(offset).toBe(6000 - 1020);
  });
});

describe("remainingMs (KTD9)", () => {
  it("returns full timer at reveal and counts down with elapsed server time", () => {
    const revealAt = 10_000;
    const timer = 20_000;
    // Offset 0, local now == revealAt → full window.
    expect(remainingMs(revealAt, timer, 0, 10_000)).toBe(20_000);
    // 5s later → 15s left.
    expect(remainingMs(revealAt, timer, 0, 15_000)).toBe(15_000);
  });

  it("applies the clock offset so a skewed device still tracks server time", () => {
    // Device clock is 3000ms behind server; offset corrects it forward.
    const revealAt = 10_000; // server ms
    expect(remainingMs(revealAt, 20_000, 3000, 12_000)).toBe(20_000 - (12_000 + 3000 - 10_000));
  });

  it("never goes negative past the deadline", () => {
    expect(remainingMs(10_000, 20_000, 0, 40_000)).toBe(0);
  });

  it("returns full timer during get-ready (before reveal)", () => {
    expect(remainingMs(10_000, 20_000, 0, 7_000)).toBe(20_000);
  });
});

describe("get-ready helpers", () => {
  it("msUntilReveal counts down to zero", () => {
    expect(msUntilReveal(10_000, 0, 7_000)).toBe(3_000);
    expect(msUntilReveal(10_000, 0, 10_000)).toBe(0);
    expect(msUntilReveal(10_000, 0, 12_000)).toBe(0);
  });

  it("isGetReadyPhase is true only before reveal_at", () => {
    expect(isGetReadyPhase("1970-01-01T00:00:10.000Z", 0, 7_000)).toBe(true);
    expect(isGetReadyPhase("1970-01-01T00:00:10.000Z", 0, 10_000)).toBe(false);
    expect(isGetReadyPhase(null, 0, 7_000)).toBe(false);
  });
});
