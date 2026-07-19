import { describe, expect, it } from "vitest";
import {
  assertCanChallenge,
  assertCanSubmitAnswer,
  isAdvanceableStatus,
  isAnswerWindowOpen,
  type PhaseGame,
} from "../phaseGuards";

function game(over: Partial<PhaseGame> = {}): PhaseGame {
  return {
    status: "active",
    paused: false,
    reviewing: false,
    current_index: 0,
    reveal_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("isAnswerWindowOpen / assertCanSubmitAnswer", () => {
  it("allows submit only on a live, unpaused, non-review question", () => {
    expect(isAnswerWindowOpen(game())).toBe(true);
    expect(() => assertCanSubmitAnswer(game())).not.toThrow();
  });

  it("locks submit during review (answer key may already be revealable)", () => {
    expect(isAnswerWindowOpen(game({ reviewing: true }))).toBe(false);
    expect(() => assertCanSubmitAnswer(game({ reviewing: true }))).toThrow(
      /Answering is locked/,
    );
  });

  it("locks submit when paused or ended", () => {
    expect(() => assertCanSubmitAnswer(game({ paused: true }))).toThrow(/paused/);
    expect(() => assertCanSubmitAnswer(game({ status: "ended" }))).toThrow(/ended/);
  });

  it("rejects lobby / missing reveal", () => {
    expect(() =>
      assertCanSubmitAnswer(game({ status: "lobby", current_index: -1, reveal_at: null })),
    ).toThrow(/No active question/);
  });
});

describe("assertCanChallenge", () => {
  it("allows active non-spectators", () => {
    expect(() => assertCanChallenge(game(), false)).not.toThrow();
  });

  it("rejects spectators (cannot pause a room they are not scoring in)", () => {
    expect(() => assertCanChallenge(game(), true)).toThrow(/Spectators/);
  });

  it("rejects ended games and pre-start", () => {
    expect(() => assertCanChallenge(game({ status: "ended" }), false)).toThrow(/ended/);
    expect(() =>
      assertCanChallenge(game({ status: "lobby", current_index: -1 }), false),
    ).toThrow(/No active question/);
  });
});

describe("isAdvanceableStatus", () => {
  it("allows lobby and active only", () => {
    expect(isAdvanceableStatus("lobby")).toBe(true);
    expect(isAdvanceableStatus("active")).toBe(true);
    expect(isAdvanceableStatus("ended")).toBe(false);
  });
});
