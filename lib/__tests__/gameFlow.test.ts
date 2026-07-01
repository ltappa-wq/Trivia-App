import { describe, expect, it } from "vitest";
import { computeNextIndex, isLastIndex } from "../gameFlow";

describe("computeNextIndex (U6 advance idempotency support)", () => {
  it("reveals question 0 from the pre-start state", () => {
    expect(computeNextIndex(-1, 5)).toBe(0);
  });

  it("advances within range", () => {
    expect(computeNextIndex(0, 5)).toBe(1);
    expect(computeNextIndex(3, 5)).toBe(4);
  });

  it("returns null when there is no next question (game should end)", () => {
    expect(computeNextIndex(4, 5)).toBeNull();
  });
});

describe("isLastIndex", () => {
  it("identifies the final question", () => {
    expect(isLastIndex(4, 5)).toBe(true);
    expect(isLastIndex(3, 5)).toBe(false);
  });
});
