import { describe, expect, it } from "vitest";
import { currentStreak } from "../streak";

describe("currentStreak (U8 celebration flourish)", () => {
  it("returns 0 for no answers", () => {
    expect(currentStreak([])).toBe(0);
  });

  it("counts a single correct answer as a streak of 1", () => {
    expect(currentStreak([{ index: 0, correct: true }])).toBe(1);
  });

  it("counts the trailing run of correct answers", () => {
    expect(
      currentStreak([
        { index: 0, correct: true },
        { index: 1, correct: true },
        { index: 2, correct: true },
      ]),
    ).toBe(3);
  });

  it("breaks the run at the most recent incorrect answer", () => {
    // Correct on 2 and 3, but wrong on the latest (4) -> streak 0.
    expect(
      currentStreak([
        { index: 2, correct: true },
        { index: 3, correct: true },
        { index: 4, correct: false },
      ]),
    ).toBe(0);
  });

  it("only counts back to the last incorrect answer", () => {
    // wrong@1 stops the count; the trailing 2,3 are correct -> streak 2.
    expect(
      currentStreak([
        { index: 0, correct: true },
        { index: 1, correct: false },
        { index: 2, correct: true },
        { index: 3, correct: true },
      ]),
    ).toBe(2);
  });

  it("is order-independent (sorts by index descending internally)", () => {
    // Descending: 4,3,2 correct, then wrong@1 stops it -> streak 3.
    expect(
      currentStreak([
        { index: 3, correct: true },
        { index: 1, correct: false },
        { index: 4, correct: true },
        { index: 2, correct: true },
      ]),
    ).toBe(3);
  });

  it("does not break the run on a gap (unanswered question)", () => {
    // Answered 1 and 3 (skipped 2), both correct -> streak 2.
    expect(
      currentStreak([
        { index: 1, correct: true },
        { index: 3, correct: true },
      ]),
    ).toBe(2);
  });
});
