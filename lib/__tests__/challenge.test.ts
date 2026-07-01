import { describe, expect, it } from "vitest";
import { CHALLENGE_CAP, disputedAnswerDelta, isAtChallengeCap, voidScoreDeltas } from "../challenge";
import { ANSWER_TIMER_MS } from "@/lib/gameConfig";

describe("isAtChallengeCap (R13, AE5)", () => {
  it("blocks once the per-player cap is reached", () => {
    expect(isAtChallengeCap(CHALLENGE_CAP - 1)).toBe(false);
    expect(isAtChallengeCap(CHALLENGE_CAP)).toBe(true);
    expect(isAtChallengeCap(CHALLENGE_CAP + 1)).toBe(true);
  });

  it("honors a custom cap", () => {
    expect(isAtChallengeCap(1, 2)).toBe(false);
    expect(isAtChallengeCap(2, 2)).toBe(true);
  });
});

describe("voidScoreDeltas (R12)", () => {
  it("reverses each player's awarded points for the voided question", () => {
    const deltas = voidScoreDeltas([
      { player_id: "a", awarded_points: 150 },
      { player_id: "b", awarded_points: 0 },
      { player_id: "c", awarded_points: 120 },
    ]);
    expect(deltas.get("a")).toBe(-150);
    expect(deltas.get("c")).toBe(-120);
    // A zero-point answer contributes no adjustment.
    expect(deltas.has("b")).toBe(false);
  });

  it("aggregates multiple answers from the same player", () => {
    const deltas = voidScoreDeltas([
      { player_id: "a", awarded_points: 100 },
      { player_id: "a", awarded_points: 50 },
    ]);
    expect(deltas.get("a")).toBe(-150);
  });
});

describe("disputedAnswerDelta (R12, AE4)", () => {
  const reveal = 100_000;

  it("credits the delta between the new correct score and what was awarded", () => {
    // Player was marked wrong (0 awarded); upheld -> full correct speed score.
    const submitAt = reveal + 0.25 * ANSWER_TIMER_MS.type_answer;
    const { newPoints, delta } = disputedAnswerDelta({
      mode: "type_answer",
      revealAtMs: reveal,
      submitAtMs: submitAt,
      currentAwarded: 0,
    });
    expect(newPoints).toBeGreaterThan(0);
    expect(delta).toBe(newPoints); // nothing was awarded before
  });

  it("returns a zero delta when the answer already had the correct score", () => {
    const submitAt = reveal + 5_000;
    const first = disputedAnswerDelta({
      mode: "multiple_choice",
      revealAtMs: reveal,
      submitAtMs: submitAt,
      currentAwarded: 0,
    });
    const requp = disputedAnswerDelta({
      mode: "multiple_choice",
      revealAtMs: reveal,
      submitAtMs: submitAt,
      currentAwarded: first.newPoints,
    });
    expect(requp.delta).toBe(0);
  });
});
