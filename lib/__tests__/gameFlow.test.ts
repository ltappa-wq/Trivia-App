import { describe, expect, it } from "vitest";
import { computeNextIndex, isBeforeReveal, isLastIndex, shouldAutoClose } from "../gameFlow";
import { ANSWER_TIMER_MS } from "../gameConfig";

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

describe("isBeforeReveal (KTD4 lead-in early-submit guard)", () => {
  const revealAt = new Date(10_000).toISOString();

  it("rejects a submit strictly before reveal_at (during the lead-in)", () => {
    expect(isBeforeReveal(9_999, revealAt)).toBe(true);
    expect(isBeforeReveal(0, revealAt)).toBe(true);
  });

  it("admits a submit at the exact reveal instant (elapsed 0, legit open)", () => {
    expect(isBeforeReveal(10_000, revealAt)).toBe(false);
  });

  it("admits a submit after the answer window has opened", () => {
    expect(isBeforeReveal(10_001, revealAt)).toBe(false);
    expect(isBeforeReveal(25_000, revealAt)).toBe(false);
  });

  it("never guards when there is no reveal_at", () => {
    expect(isBeforeReveal(0, null)).toBe(false);
  });
});

describe("shouldAutoClose (R4 next-question race fix)", () => {
  const now = 1_700_000_000_000;
  const mc = ANSWER_TIMER_MS.multiple_choice;

  it("does NOT close a freshly-revealed question (the reported bug)", () => {
    // reveal_at just stamped by advance → a full window remains, regardless of
    // any stale countdown value the caller might still hold.
    const revealAt = new Date(now).toISOString();
    expect(
      shouldAutoClose({ reveal_at: revealAt, answer_mode: "multiple_choice", current_index: 3 }, 0, now),
    ).toBe(false);
  });

  it("closes once the answer window has elapsed", () => {
    const revealAt = new Date(now - mc - 1_000).toISOString();
    expect(
      shouldAutoClose({ reveal_at: revealAt, answer_mode: "multiple_choice", current_index: 3 }, 0, now),
    ).toBe(true);
  });

  it("closes exactly at the boundary (remaining hits zero)", () => {
    const revealAt = new Date(now - mc).toISOString();
    expect(
      shouldAutoClose({ reveal_at: revealAt, answer_mode: "multiple_choice", current_index: 3 }, 0, now),
    ).toBe(true);
  });

  it("never closes before start (current_index < 0) or without a reveal", () => {
    const revealAt = new Date(now - mc - 1_000).toISOString();
    expect(
      shouldAutoClose({ reveal_at: revealAt, answer_mode: "multiple_choice", current_index: -1 }, 0, now),
    ).toBe(false);
    expect(
      shouldAutoClose({ reveal_at: null, answer_mode: "multiple_choice", current_index: 3 }, 0, now),
    ).toBe(false);
  });

  it("respects the clock offset when the local clock is skewed", () => {
    // Server is 30s ahead; the question was revealed 5s ago in server time, so a
    // window remains even though the raw local delta looks larger.
    const offset = 30_000;
    const revealAt = new Date(now + offset - 5_000).toISOString();
    expect(
      shouldAutoClose({ reveal_at: revealAt, answer_mode: "multiple_choice", current_index: 3 }, offset, now),
    ).toBe(false);
  });
});
