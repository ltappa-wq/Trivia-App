import { expect, it } from "vitest";
import { answerTimerMs, validateSetupInput } from "../gameConfig";
import { computeScore } from "../scoring/speed";
import { judgeTrueFalse } from "../judging/match";
import { parseSavedSetup } from "../savedSetup";
import { formatAnswerKey } from "../reviewAnswer";
it.each([["multiple_choice", 20000], ["type_answer", 35000], ["true_false", 15000]] as const)("uses question %s timer and matching score decay", (mode, timer) => {
  expect(answerTimerMs({ answer_mode: "mixed" }, { mode })).toBe(timer);
  expect(answerTimerMs({ answer_mode: "mixed", answer_timer_ms: 60000 }, { mode })).toBe(60000);
  const score = (elapsed: number, multiplier = 1) => computeScore({ correct: true, mode, revealAtMs: 0, submitAtMs: elapsed, multiplier });
  expect(score(1000)).toBe(1000); expect(score((timer + 1000) / 2)).toBe(750);
  expect(score(timer)).toBe(500); expect(score(timer, 2)).toBe(1000); expect(score(timer + 1)).toBe(0);
});
it("judges binary tile indices exactly", () => {
  expect(judgeTrueFalse("0", 0)).toBe(true); expect(judgeTrueFalse("1", 1)).toBe(true);
  for (const raw of ["true", "false", "0junk", "01", " 0", "2", ""]) expect(judgeTrueFalse(raw, 0)).toBe(false);
  expect(judgeTrueFalse("1", 0)).toBe(false);
});
it.each(["mixed", "true_false"])("accepts and remembers %s setup", answerMode => {
  const settings = { categories: ["Science"], questionCount: 4, answerMode, difficulty: "easy", hostPlays: false, hostName: "" };
  expect(validateSetupInput(settings).ok).toBe(true);
  expect(parseSavedSetup(JSON.stringify({ version: 1, settings }))?.answerMode).toBe(answerMode);
});
it("reveals the human-readable binary answer", () => {
  expect(formatAnswerKey({ index: 0, mode: "true_false", options: ["True", "False"], correct_option: 1, accepted_variants: null, correction: null })).toBe("False");
});
