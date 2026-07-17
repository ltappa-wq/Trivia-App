import { describe, expect, it } from "vitest";
import { computeScore, DEADLINE_POINTS, FULL_POINTS_MS, MAX_POINTS } from "../speed";
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

  it("still awards MAX_POINTS anywhere inside the opening grace second", () => {
    for (const mode of ["multiple_choice", "type_answer"] as const) {
      // At the very end of the first second — still full points.
      expect(
        computeScore({
          correct: true,
          mode,
          revealAtMs: reveal,
          submitAtMs: reveal + FULL_POINTS_MS,
        }),
      ).toBe(MAX_POINTS);
      // Halfway through the first second — full points.
      expect(
        computeScore({ correct: true, mode, revealAtMs: reveal, submitAtMs: reveal + 500 }),
      ).toBe(MAX_POINTS);
    }
  });

  it("awards exactly DEADLINE_POINTS for a correct answer at the deadline", () => {
    for (const mode of ["multiple_choice", "type_answer"] as const) {
      expect(
        computeScore({
          correct: true,
          mode,
          revealAtMs: reveal,
          submitAtMs: reveal + ANSWER_TIMER_MS[mode],
        }),
      ).toBe(DEADLINE_POINTS);
    }
  });

  it("never scores a correct in-window answer below DEADLINE_POINTS", () => {
    // Just inside the deadline stays at the floor, not below.
    const nearDeadline = computeScore({
      correct: true,
      mode: "multiple_choice",
      revealAtMs: reveal,
      submitAtMs: reveal + ANSWER_TIMER_MS.multiple_choice - 1,
    });
    expect(nearDeadline).toBeGreaterThanOrEqual(DEADLINE_POINTS);
  });

  it("scores a faster correct answer higher than a slower one past the grace second (AE2)", () => {
    const fast = computeScore({
      correct: true,
      mode: "multiple_choice",
      revealAtMs: reveal,
      submitAtMs: reveal + 3_000,
    });
    const slow = computeScore({
      correct: true,
      mode: "multiple_choice",
      revealAtMs: reveal,
      submitAtMs: reveal + 10_000,
    });
    expect(fast).toBeGreaterThan(slow);
    expect(fast).toBeLessThan(MAX_POINTS); // past the grace second, below full
  });

  it("decays linearly from the grace second to the deadline (10s of the 20s MC window)", () => {
    const mid = computeScore({
      correct: true,
      mode: "multiple_choice",
      revealAtMs: reveal,
      submitAtMs: reveal + 10_000,
    });
    // decay fraction = (10000 - 1000) / (20000 - 1000) = 9000/19000
    // points = 1000 - round(500 * 9000/19000) = 1000 - 237 = 763
    expect(mid).toBe(763);
  });

  it("decays more gently in the longer type-answer window for the same elapsed time (AE2)", () => {
    // The grace second is absolute, but the decay runs over each mode's own
    // window, so at the same absolute elapsed the longer window scores higher.
    const elapsed = 10_000;
    const mc = computeScore({
      correct: true,
      mode: "multiple_choice",
      revealAtMs: reveal,
      submitAtMs: reveal + elapsed,
    });
    const type = computeScore({
      correct: true,
      mode: "type_answer",
      revealAtMs: reveal,
      submitAtMs: reveal + elapsed,
    });
    expect(type).toBeGreaterThan(mc);
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
