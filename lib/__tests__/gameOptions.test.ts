import { describe, expect, it } from "vitest";
import { answerTimerMs, questionMultiplier, validateSetupInput, ANSWER_TIMER_OPTIONS, AUTO_ADVANCE_OPTIONS } from "../gameConfig";
import { computeScore } from "../scoring/speed";
import { shouldAutoClose } from "../gameFlow";
import { autoCloseDeadline } from "../realtime/autoClose";
import { autoAdvanceDeadline, canAutoAdvance } from "../realtime/autoAdvance";
import type { ClientGame } from "../db/types";

const setup = { categories: ["History"], questionCount: 3, answerMode: "multiple_choice", difficulty: "medium" };
const game: ClientGame = { id: "g", code: "12345", status: "active", answer_mode: "multiple_choice", difficulty: "medium", question_count: 3, current_index: 0, reveal_at: new Date(0).toISOString(), paused: false, reviewing: true, auto_advance_ms: 8000, auto_advance_at: new Date(10000).toISOString() };

describe("game options validation", () => {
  it("keeps old input valid and preserves every supported option", () => {
    expect(validateSetupInput(setup)).toEqual({ ok: true, value: setup });
    for (const answerTimerMs of ANSWER_TIMER_OPTIONS) for (const autoAdvanceMs of AUTO_ADVANCE_OPTIONS) {
      const input = { ...setup, answerTimerMs, autoAdvanceMs, doublePointsFinale: true };
      expect(validateSetupInput(input)).toEqual({ ok: true, value: input });
    }
    expect(validateSetupInput({ ...setup, answerTimerMs: null, autoAdvanceMs: null }).ok).toBe(true);
  });
  it.each([{ answerTimerMs: 35000 }, { answerTimerMs: "20000" }, { answerTimerMs: 0 }, { autoAdvanceMs: 1 }, { autoAdvanceMs: false }, { doublePointsFinale: "true" }, { doublePointsFinale: null }])("rejects invalid settings %j", options => {
    expect(validateSetupInput({ ...setup, ...options }).ok).toBe(false);
  });
  it("uses legacy per-mode defaults for omitted/null settings", () => {
    expect(answerTimerMs({ answer_mode: "multiple_choice" })).toBe(20000);
    expect(answerTimerMs({ answer_mode: "type_answer", answer_timer_ms: null })).toBe(35000);
    expect(answerTimerMs({ answer_mode: "type_answer", answer_timer_ms: 10000 })).toBe(10000);
  });
});

describe("custom timing and finale scoring", () => {
  it.each(ANSWER_TIMER_OPTIONS)("decays across the selected %i ms window", timerMs => {
    const score = (submitAtMs: number, multiplier = 1, correct = true) => computeScore({ correct, mode: "type_answer", revealAtMs: 0, submitAtMs, timerMs, multiplier });
    expect(score(1000)).toBe(1000);
    expect(score(1000 + (timerMs - 1000) / 2)).toBe(750);
    expect(score(timerMs)).toBe(500);
    expect(score(timerMs + 1)).toBe(0);
    expect(score(1000, 2)).toBe(2000);
    expect(score(timerMs, 2)).toBe(1000);
    expect(score(timerMs + 1, 2)).toBe(0);
    expect(score(1000, 2, false)).toBe(0);
  });
  it("doubles only the enabled final question, including a one-question game", () => {
    expect(questionMultiplier({ ...game, double_points_finale: true })).toBe(1);
    expect(questionMultiplier({ ...game, current_index: 2, double_points_finale: true })).toBe(2);
    expect(questionMultiplier({ ...game, current_index: 2 })).toBe(1);
    expect(questionMultiplier({ ...game, question_count: 1, double_points_finale: true })).toBe(2);
  });
});

describe("deadline helpers", () => {
  it("uses custom timers in close decisions and includes the server grace", () => {
    const custom = { ...game, answer_timer_ms: 60000 };
    expect(autoCloseDeadline(custom)).toBe(60750);
    expect(shouldAutoClose(custom, 0, 59999)).toBe(false);
    expect(shouldAutoClose(custom, 0, 60000)).toBe(true);
  });
  it("waits for the review deadline and never finishes the last question", () => {
    expect(autoAdvanceDeadline(game)).toBe(10000);
    expect(canAutoAdvance(game, 9999)).toBe(false);
    expect(canAutoAdvance(game, 10000)).toBe(true);
    for (const patch of [{ paused: true }, { reviewing: false }, { current_index: 2 }, { status: "ended" as const }, { auto_advance_ms: null }, { auto_advance_at: null }, { auto_advance_at: "bad" }]) {
      expect(canAutoAdvance({ ...game, ...patch }, 20000)).toBe(false);
    }
  });
});
