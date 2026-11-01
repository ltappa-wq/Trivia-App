import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureGenerationEnabled, fixtureQuestions } from "../fixture";
import { correctAnswerKeys, validateGeneratedQuestion } from "../schema";

afterEach(() => vi.unstubAllEnvs());
describe("fixture safety", () => {
  it.each([
    ["production", "fixture", undefined, false],
    ["production", "fixture", "true", false],
    ["production", "fixture", "1", true],
    ["development", "fixture", undefined, true],
    ["test", "fixture", undefined, true],
    ["production", undefined, "1", false],
    ["development", undefined, "1", false],
  ])("%s mode=%s flag=%s -> %s", (node, mode, flag, enabled) => {
    vi.stubEnv("NODE_ENV", node);
    vi.stubEnv("GENERATION_MODE", mode);
    vi.stubEnv("E2E_TEST_MODE", flag);
    expect(fixtureGenerationEnabled()).toBe(enabled);
  });
});
it.each(["multiple_choice", "type_answer"] as const)("provides 100 repeatable, valid, distinct %s questions", (mode) => {
  const params = { categories: ["Geography"], count: 100, mode, difficulty: "medium" as const };
  const questions = fixtureQuestions(params);
  expect(questions).toEqual(fixtureQuestions(params));
  expect(questions).toHaveLength(100);
  expect(new Set(questions.map(q => q.prompt)).size).toBe(100);
  expect(new Set(questions.flatMap(correctAnswerKeys)).size).toBe(100);
  for (const question of questions) {
    const result = validateGeneratedQuestion(question, params);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.question.explanation).toBe(question.explanation);
    expect(question.explanation).toBeTruthy();
  }
  expect(questions[0]?.prompt).toBe("Fixture 1: spell the number 0.");
});
it.each([0, 101, 1.5])("rejects invalid count %s", count => {
  expect(() => fixtureQuestions({ categories: [], count, mode: "type_answer", difficulty: "easy" })).toThrow();
});
