import { describe, expect, it } from "vitest";
import { BASE_POINTS, computeScore } from "../speed";
import { ANSWER_TIMER_MS } from "@/lib/gameConfig";

const reveal = 100_000;

describe("computeScore (R7, KTD4)", () => {
  it("awards base + full time bonus for an instant correct answer", () => {
    const score = computeScore({
      correct: true,
      mode: "multiple_choice",
      revealAtMs: reveal,
      submitAtMs: reveal, // answered at the reveal instant
    });
    expect(score).toBeGreaterThan(BASE_POINTS);
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

  it("does not penalize type-the-answer at an equal fraction of its timer (AE2)", () => {
    // Same fraction (25%) of each mode's own window.
    const mcFrac = 0.25 * ANSWER_TIMER_MS.multiple_choice;
    const typeFrac = 0.25 * ANSWER_TIMER_MS.type_answer;
    const mc = computeScore({
      correct: true,
      mode: "multiple_choice",
      revealAtMs: reveal,
      submitAtMs: reveal + mcFrac,
    });
    const type = computeScore({
      correct: true,
      mode: "type_answer",
      revealAtMs: reveal,
      submitAtMs: reveal + typeFrac,
    });
    expect(type).toBeGreaterThanOrEqual(mc);
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

  it("clamps pre-reveal clock skew to the maximum bonus rather than overflowing", () => {
    const skewed = computeScore({
      correct: true,
      mode: "type_answer",
      revealAtMs: reveal,
      submitAtMs: reveal - 5_000, // submit stamp before reveal
    });
    const atReveal = computeScore({
      correct: true,
      mode: "type_answer",
      revealAtMs: reveal,
      submitAtMs: reveal,
    });
    expect(skewed).toBe(atReveal);
  });
});
