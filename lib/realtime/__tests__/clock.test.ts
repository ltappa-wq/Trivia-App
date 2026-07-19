import { describe, expect, it } from "vitest";
import { measureClockOffset, remainingMs, untilRevealMs } from "../clock";

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
});

describe("untilRevealMs (lead-in)", () => {
  it("counts down the ms until a future reveal, offset-corrected", () => {
    const revealAt = 13_000; // reveal opens 3s after 'now'
    // Offset 0, local now 10_000 → 3000ms of lead-in remain.
    expect(untilRevealMs(revealAt, 0, 10_000)).toBe(3000);
    // 2s later → 1000ms remain.
    expect(untilRevealMs(revealAt, 0, 12_000)).toBe(1000);
  });

  it("applies the clock offset like the answer countdown", () => {
    // Device is 3000ms behind server; offset pushes its clock forward, so the
    // lead-in it sees is shorter.
    const revealAt = 13_000;
    expect(untilRevealMs(revealAt, 3000, 10_000)).toBe(13_000 - (10_000 + 3000));
  });

  it("is zero once the answer window has opened", () => {
    expect(untilRevealMs(10_000, 0, 12_000)).toBe(0);
  });
});
