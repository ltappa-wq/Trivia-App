import { describe, expect, it } from "vitest";
import { computeScore, FLOOR_POINTS, MAX_POINTS } from "../speed";
import { ANSWER_TIMER_MS } from "@/lib/gameConfig";

const reveal = 100_000;

describe("computeScore (R4, R7, KTD1, KTD4)", () => {
  it("awards MAX_POINTS for a correct answer at the reveal instant", () => {
    for (const mode of ["multiple_choice", "type_answer"] as const) {
      expect(
        computeScore({ correct: true, mode, revealAtMs: reveal, submitAtMs: reveal }),
      ).toBe(MAX_POINTS);
    }
  });

  it("awards exactly FLOOR_POINTS for a correct answer at the deadline", () => {
    for (const mode of ["multiple_choice", "type_answer"] as const) {
      expect(
        computeScore({
          correct: true,
          mode,
          revealAtMs: reveal,
          submitAtMs: reveal + ANSWER_TIMER_MS[mode],
        }),
      ).toBe(FLOOR_POINTS);
    }
  });

  it("never scores a correct in-window answer below FLOOR_POINTS", () => {
    // Just inside the deadline stays at the floor, not below.
    const nearDeadline = computeScore({
      correct: true,
      mode: "multiple_choice",
      revealAtMs: reveal,
      submitAtMs: reveal + ANSWER_TIMER_MS.multiple_choice - 1,
    });
    expect(nearDeadline).toBeGreaterThanOrEqual(FLOOR_POINTS);
  });

  it("scores a faster correct answer higher than a slower one (AE2)", () => {
    const fast = computeScore({
      correct: true,
      mode: "multiple_choice",
      revealAtMs: reveal,
      submitAtMs: reveal + 2_000,
    });
    const slow = computeScore({
      correct: true,
      mode: "multiple_choice",
      revealAtMs: reveal,
      submitAtMs: reveal + 10_000,
    });
    expect(fast).toBeGreaterThan(slow);
  });

  it("interpolates linearly at mid-window (10s of the 20s MC window -> 550)", () => {
    const mid = computeScore({
      correct: true,
      mode: "multiple_choice",
      revealAtMs: reveal,
      submitAtMs: reveal + 10_000, // 50% of the 20s window
    });
    expect(mid).toBe(550); // 100 floor + 450 (half of the 900 bonus)
  });

  it("gives equal points for equal fractions across modes (AE2)", () => {
    // Same fraction (25%) of each mode's own window -> identical score.
    const mc = computeScore({
      correct: true,
      mode: "multiple_choice",
      revealAtMs: reveal,
      submitAtMs: reveal + 0.25 * ANSWER_TIMER_MS.multiple_choice,
    });
    const type = computeScore({
      correct: true,
      mode: "type_answer",
      revealAtMs: reveal,
      submitAtMs: reveal + 0.25 * ANSWER_TIMER_MS.type_answer,
    });
    expect(type).toBe(mc);
  });

  it("scores a wrong answer 0", () => {
    expect(
      computeScore({ correct: false, mode: "multiple_choice", revealAtMs: reveal, submitAtMs: reveal }),
    ).toBe(0);
  });

  it("scores a late (past-window) answer 0 even if correct", () => {
    const late = computeScore({
      correct: true,
      mode: "multiple_choice",
      revealAtMs: reveal,
      submitAtMs: reveal + ANSWER_TIMER_MS.multiple_choice + 1,
    });
    expect(late).toBe(0);
  });

  it("clamps pre-reveal clock skew to MAX_POINTS rather than overflowing", () => {
    const skewed = computeScore({
      correct: true,
      mode: "type_answer",
      revealAtMs: reveal,
      submitAtMs: reveal - 5_000, // submit stamp before reveal
    });
    expect(skewed).toBe(MAX_POINTS);
  });
});
